import { randomUUID } from 'node:crypto';

import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda';
import type { APIGatewayProxyHandlerV2 } from 'aws-lambda';

import type { ProviderConfigItem, UserProfileItem } from '../lib/dynamo';
import { DEFAULT_USER_TEMP_PASSWORD } from '../lib/env';
import { badRequest, conflict, created, ok, serverError } from '../lib/response';
import { getModelCache, saveModelCache } from '../repositories/model-cache';
import {
  deleteProviderConfig,
  getProviderConfig,
  listProviderConfigs,
  saveProviderConfig
} from '../repositories/providers';
import { upsertQuota } from '../repositories/quotas';
import { refreshModelsForProvider } from '../services/model-refresh';
import {
  deleteProviderApiKey,
  getProviderApiKey,
  storeProviderApiKey
} from '../services/provider-secrets';
import {
  createUserWithDefaults,
  deleteUserAccount,
  listUsersWithOptions,
  updateUserProfile,
  type AdminCreateUserInput
} from '../services/user-management';

interface ProviderCreatePayload {
  providerType: string;
  instanceName: string;
  apiKey: string;
}

interface ProviderUpdatePayload {
  instanceName?: string;
  apiKey?: string;
  status?: 'active' | 'revoked' | 'pending';
}

interface QuotaPayload {
  userId: string;
  provider: string;
  monthlyTokenLimit?: number;
  monthlySpendLimitGBP?: number;
}

interface CreateUserPayload {
  userId?: string;
  email: string;
  displayName: string;
  role: 'student' | 'admin';
  isActive?: boolean;
  temporaryPassword?: string;
  firstName?: string;
  lastName?: string;
  avatarKey?: string;
}

interface UpdateUserPayload {
  displayName?: string;
  role?: 'student' | 'admin';
  isActive?: boolean;
  firstName?: string;
  lastName?: string;
  avatarKey?: string | null;
}

const sanitizeUser = (user: UserProfileItem) => ({
  userId: user.userId,
  email: user.email,
  displayName: user.displayName,
  role: user.role,
  firstName: user.firstName,
  lastName: user.lastName,
  avatarKey: user.avatarKey,
  createdAt: user.createdAt,
  updatedAt: user.updatedAt,
  isActive: user.isActive
});

const parseJson = <T>(body: string): T => JSON.parse(body);

const PROVIDER_TYPES = new Set(['openai', 'copilot', 'claude', 'gemini']);

const slugify = (value: string) =>
  value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
    .slice(0, 64);

const randomSuffix = () => randomUUID().split('-')[0];

const guessProviderType = (config: ProviderConfigItem): string => {
  if (config.providerType) return config.providerType;

  const id = config.provider.toLowerCase();
  if (id.includes('openai') || id.includes('gpt')) {
    return 'openai';
  }
  if (id.includes('claude')) {
    return 'claude';
  }
  if (id.includes('gemini')) {
    return 'gemini';
  }
  if (id.includes('copilot')) {
    return 'copilot';
  }

  return 'openai';
};

const mapProviderResponse = (config: ProviderConfigItem, apiKey: string) => ({
  providerId: config.provider,
  providerType: guessProviderType(config),
  instanceName: config.instanceName ?? config.label ?? config.provider,
  status: config.status,
  apiKey,
  secretId: config.secretId,
  createdAt: config.createdAt,
  updatedAt: config.updatedAt,
  lastRotatedAt: config.lastRotatedAt ?? null
});

const generateProviderId = async (providerType: string, instanceName: string) => {
  const baseInstance = slugify(instanceName);
  const baseId = baseInstance ? `${providerType}-${baseInstance}` : providerType;

  let candidate = baseId;
  let attempt = 0;
  // Ensure uniqueness by appending a short random suffix if needed.
  // Limit attempts to avoid infinite loops.
  while ((await getProviderConfig(candidate)) && attempt < 5) {
    candidate = `${baseId}-${randomSuffix()}`.slice(0, 80);
    attempt += 1;
  }

  if (await getProviderConfig(candidate)) {
    throw new Error('Unable to create a unique provider identifier');
  }

  return candidate;
};

export const users: APIGatewayProxyHandlerV2 = async (event) => {
  try {
    if (!event.body) {
      return badRequest('Request body is required');
    }

    const payload = parseJson<CreateUserPayload>(event.body);

    if (!payload.email || !payload.displayName || !payload.role) {
      return badRequest('email, displayName and role are required');
    }

    const user = await createUserWithDefaults(payload as AdminCreateUserInput);

    return created({
      user: sanitizeUser(user),
      temporaryPassword: payload.temporaryPassword ?? DEFAULT_USER_TEMP_PASSWORD
    });
  } catch (error) {
    console.error('admin.users error', error);
    if (error instanceof Error && error.message.includes('already exists')) {
      return conflict(error.message);
    }
    return serverError(error);
  }
};

export const providers: APIGatewayProxyHandlerV2 = async (event) => {
  try {
    const method = event.requestContext.http.method.toUpperCase();

    if (method === 'GET') {
      const configs = await listProviderConfigs();
      const items = await Promise.all(
        configs.map(async (config) => {
          try {
            const apiKey = await getProviderApiKey(config.provider);
            return mapProviderResponse(config, apiKey);
          } catch (error) {
            console.error(`admin.providers list failed to fetch key for ${config.provider}`, error);
            return mapProviderResponse(config, '');
          }
        })
      );

      return ok({ items });
    }

    if (method === 'POST') {
      if (!event.body) {
        return badRequest('Request body is required');
      }

      const payload = parseJson<ProviderCreatePayload>(event.body);

      if (!payload.providerType || !payload.instanceName || !payload.apiKey) {
        return badRequest('providerType, instanceName and apiKey are required');
      }

      const providerType = payload.providerType.toLowerCase();
      if (!PROVIDER_TYPES.has(providerType)) {
        return badRequest(`providerType must be one of: ${Array.from(PROVIDER_TYPES).join(', ')}`);
      }

      const instanceName = payload.instanceName.trim();
      if (!instanceName) {
        return badRequest('instanceName is required');
      }

      const apiKey = payload.apiKey.trim();
      if (!apiKey) {
        return badRequest('apiKey must not be empty');
      }

      const providerId = await generateProviderId(providerType, instanceName);
      const secretId = await storeProviderApiKey(providerId, apiKey);
      const config = await saveProviderConfig({
        provider: providerId,
        secretId,
        providerType,
        instanceName,
        label: instanceName,
        status: 'active'
      });

      return ok({
        item: mapProviderResponse(config, apiKey)
      });
    }

    if (method === 'PUT') {
      const providerId = event.pathParameters?.providerId;
      if (!providerId) {
        return badRequest('providerId path parameter is required');
      }

      if (!event.body) {
        return badRequest('Request body is required');
      }

      const payload = parseJson<ProviderUpdatePayload>(event.body);

      if (!payload.instanceName && !payload.apiKey && !payload.status) {
        return badRequest('Provide at least one field to update');
      }

      const existing = await getProviderConfig(providerId);
      if (!existing) {
        return badRequest(`Provider ${providerId} not found`);
      }

      let secretId = existing.secretId;
      let rotatedKey: string | undefined;
      if (payload.apiKey !== undefined) {
        const trimmedKey = payload.apiKey.trim();
        if (!trimmedKey) {
          return badRequest('apiKey must not be empty');
        }

        secretId = await storeProviderApiKey(providerId, trimmedKey);
        rotatedKey = trimmedKey;
      }

      const instanceName = payload.instanceName?.trim();

      const config = await saveProviderConfig({
        provider: providerId,
        secretId,
        providerType: existing.providerType,
        instanceName: instanceName ?? existing.instanceName ?? existing.label,
        label: instanceName ?? existing.label,
        status: payload.status ?? existing.status
      });

      const apiKey = rotatedKey ?? (await getProviderApiKey(providerId));

      return ok({
        item: mapProviderResponse(config, apiKey)
      });
    }

    if (method === 'DELETE') {
      const providerId = event.pathParameters?.providerId;
      if (!providerId) {
        return badRequest('providerId path parameter is required');
      }

      const existing = await getProviderConfig(providerId);
      if (!existing) {
        return ok({ success: true, deleted: false });
      }

      await deleteProviderApiKey(providerId);
      await deleteProviderConfig(providerId);

      return ok({ success: true, deleted: true });
    }

    return badRequest(`Unsupported method ${method}`);
  } catch (error) {
    console.error('admin.providers error', error);
    return serverError(error);
  }
};

export const usersList: APIGatewayProxyHandlerV2 = async (event) => {
  try {
    const query = event.queryStringParameters ?? {};
    const limit = query.limit ? Number.parseInt(query.limit, 10) : undefined;
    if (limit !== undefined && (Number.isNaN(limit) || limit <= 0)) {
      return badRequest('limit must be a positive number');
    }

    const result = await listUsersWithOptions({
      limit,
      cursor: query.cursor,
      search: query.search?.trim() || undefined
    });

    return ok({
      items: result.items.map(sanitizeUser),
      nextCursor: result.nextCursor ?? null
    });
  } catch (error) {
    console.error('admin.usersList error', error);
    return serverError(error);
  }
};

export const usersUpdate: APIGatewayProxyHandlerV2 = async (event) => {
  try {
    const userId = event.pathParameters?.userId;
    if (!userId) {
      return badRequest('userId path parameter is required');
    }

    if (!event.body) {
      return badRequest('Request body is required');
    }

    const payload = parseJson<UpdateUserPayload>(event.body);
    const updated = await updateUserProfile({ userId, ...payload });

    return ok({ user: sanitizeUser(updated) });
  } catch (error) {
    console.error('admin.usersUpdate error', error);
    return serverError(error);
  }
};

export const usersDelete: APIGatewayProxyHandlerV2 = async (event) => {
  try {
    const userId = event.pathParameters?.userId;
    if (!userId) {
      return badRequest('userId path parameter is required');
    }

    await deleteUserAccount(userId);

    return ok({ success: true });
  } catch (error) {
    console.error('admin.usersDelete error', error);
    return serverError(error);
  }
};

export const quotas: APIGatewayProxyHandlerV2 = async (event) => {
  try {
    if (!event.body) {
      return badRequest('Request body is required');
    }

    const payload = parseJson<QuotaPayload>(event.body);

    if (!payload.userId || !payload.provider) {
      return badRequest('userId and provider are required');
    }

    const quota = await upsertQuota({
      userId: payload.userId,
      provider: payload.provider,
      monthlyTokenLimit: payload.monthlyTokenLimit,
      monthlySpendLimitGBP: payload.monthlySpendLimitGBP
    });

    return ok({
      userId: quota.userId,
      provider: quota.provider,
      monthlyTokenLimit: quota.monthlyTokenLimit,
      monthlySpendLimitGBP: quota.monthlySpendLimitGBP
    });
  } catch (error) {
    console.error('admin.quotas error', error);
    return serverError(error);
  }
};

export const usage: APIGatewayProxyHandlerV2 = async (event) => {
  try {
    const query = event.queryStringParameters ?? {};
    const scope = query.scope ?? 'organisation';

    // TODO: Aggregate usage metrics from DynamoDB or ClickHouse (future).
    return ok({
      scope,
      usage: [],
      message: 'Usage reporting not implemented yet'
    });
  } catch (error) {
    console.error('admin.usage error', error);
    return serverError(error);
  }
};

export const refreshModels: APIGatewayProxyHandlerV2 = async () => {
  try {
    console.log('[Admin] Manual model refresh requested - invoking async Lambda');

    // Get list of providers that will be refreshed
    const providers = await listProviderConfigs();
    const openaiProviders = providers.filter(
      (p) => p.status === 'active' && (p.provider.includes('openai') || p.provider.includes('gpt'))
    );

    const providerIds = openaiProviders.map((p) => p.provider);
    console.log(`[Admin] Will refresh ${providerIds.length} providers: ${providerIds.join(', ')}`);

    // Invoke the scheduled refresh Lambda asynchronously
    const lambdaClient = new LambdaClient({});
    const functionName = `sinapsi-${process.env.STAGE || 'dev'}-scheduledModelRefresh`;

    await lambdaClient.send(
      new InvokeCommand({
        FunctionName: functionName,
        InvocationType: 'Event', // Async invocation - don't wait for response
        Payload: JSON.stringify({}) // Empty event payload
      })
    );

    console.log(`[Admin] Async Lambda invocation sent to ${functionName}`);

    // Return immediately - frontend will poll for completion
    return ok({
      message: 'Refresh started',
      providers: providerIds
    });
  } catch (error) {
    console.error('admin.refreshModels error', error);
    return serverError(error);
  }
};

export const getModelsCache: APIGatewayProxyHandlerV2 = async () => {
  try {
    console.log('[Admin] Fetching all model caches');
    const providers = await listProviderConfigs();
    const openaiProviders = providers.filter((p) =>
      p.provider.includes('openai') || p.provider.includes('gpt')
    );

    const caches = await Promise.all(
      openaiProviders.map(async (provider) => {
        const cache = await getModelCache(provider.provider);
        return {
          providerId: provider.provider,
          providerName: provider.instanceName || provider.provider,
          models: cache?.models || [],
          lastRefreshed: cache?.lastRefreshed || null
        };
      })
    );

    return ok({ providers: caches });
  } catch (error) {
    console.error('admin.getModelsCache error', error);
    return serverError(error);
  }
};

export const blacklistModel: APIGatewayProxyHandlerV2 = async (event) => {
  try {
    if (!event.body) {
      return badRequest('Request body is required');
    }

    const payload = JSON.parse(event.body) as {
      provider: string;
      modelId: string;
      blacklisted: boolean;
    };

    if (!payload.provider || !payload.modelId || payload.blacklisted === undefined) {
      return badRequest('provider, modelId, and blacklisted are required');
    }

    console.log(`[Admin] ${payload.blacklisted ? 'Blacklisting' : 'Un-blacklisting'} model ${payload.modelId} for provider ${payload.provider}`);

    const cache = await getModelCache(payload.provider);
    if (!cache) {
      return badRequest(`No cache found for provider ${payload.provider}`);
    }

    // Update the blacklist flag for the specified model
    const updatedModels = cache.models.map((m) =>
      m.id === payload.modelId && m.source === 'curated'
        ? { ...m, blacklisted: payload.blacklisted }
        : m
    );

    // Save back to DynamoDB
    await saveModelCache(payload.provider, updatedModels, 'manual');

    return ok({ success: true });
  } catch (error) {
    console.error('admin.blacklistModel error', error);
    return serverError(error);
  }
};

export const addManualModel: APIGatewayProxyHandlerV2 = async (event) => {
  try {
    if (!event.body) {
      return badRequest('Request body is required');
    }

    const payload = JSON.parse(event.body) as {
      provider: string;
      modelId: string;
      displayName: string;
      supportsImageGeneration: boolean;
    };

    if (!payload.provider || !payload.modelId || !payload.displayName || payload.supportsImageGeneration === undefined) {
      return badRequest('provider, modelId, displayName, and supportsImageGeneration are required');
    }

    console.log(`[Admin] Adding manual model ${payload.modelId} to provider ${payload.provider}`);

    const cache = await getModelCache(payload.provider);
    const existingModels = cache?.models || [];

    // Check if model already exists
    if (existingModels.some((m) => m.id === payload.modelId)) {
      return badRequest(`Model ${payload.modelId} already exists in cache`);
    }

    // Add new manual model
    const newModel = {
      id: payload.modelId,
      label: payload.displayName,
      supportsImageGeneration: payload.supportsImageGeneration,
      source: 'manual' as const,
      blacklisted: false
    };

    const updatedModels = [...existingModels, newModel];

    await saveModelCache(payload.provider, updatedModels, 'manual');

    return ok({ success: true, model: newModel });
  } catch (error) {
    console.error('admin.addManualModel error', error);
    return serverError(error);
  }
};

export const deleteManualModel: APIGatewayProxyHandlerV2 = async (event) => {
  try {
    const query = event.queryStringParameters ?? {};
    const provider = query.provider;
    const modelId = query.modelId;

    if (!provider || !modelId) {
      return badRequest('provider and modelId query parameters are required');
    }

    console.log(`[Admin] Deleting manual model ${modelId} from provider ${provider}`);

    const cache = await getModelCache(provider);
    if (!cache) {
      return badRequest(`No cache found for provider ${provider}`);
    }

    // Remove the manual model
    const updatedModels = cache.models.filter(
      (m) => !(m.id === modelId && m.source === 'manual')
    );

    if (updatedModels.length === cache.models.length) {
      return badRequest(`Manual model ${modelId} not found in cache`);
    }

    await saveModelCache(provider, updatedModels, 'manual');

    return ok({ success: true });
  } catch (error) {
    console.error('admin.deleteManualModel error', error);
    return serverError(error);
  }
};
