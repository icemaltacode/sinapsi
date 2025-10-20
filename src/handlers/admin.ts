import { randomUUID } from 'node:crypto';

import type { APIGatewayProxyHandlerV2 } from 'aws-lambda';

import type { ProviderConfigItem, UserProfileItem } from '../lib/dynamo';
import { DEFAULT_USER_TEMP_PASSWORD } from '../lib/env';
import { badRequest, conflict, created, ok, serverError } from '../lib/response';
import {
  deleteProviderConfig,
  getProviderConfig,
  listProviderConfigs,
  saveProviderConfig
} from '../repositories/providers';
import { upsertQuota } from '../repositories/quotas';
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

const PROVIDER_TYPES = new Set(['gpt', 'copilot', 'claude', 'gemini']);

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
    return 'gpt';
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

  return 'gpt';
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
