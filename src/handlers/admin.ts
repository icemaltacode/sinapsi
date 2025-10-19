import type { APIGatewayProxyHandlerV2 } from 'aws-lambda';

import type { UserProfileItem } from '../lib/dynamo';
import { DEFAULT_USER_TEMP_PASSWORD } from '../lib/env';
import { badRequest, conflict, created, ok, serverError } from '../lib/response';
import { saveProviderConfig } from '../repositories/providers';
import { upsertQuota } from '../repositories/quotas';
import { storeProviderApiKey } from '../services/provider-secrets';
import {
  createUserWithDefaults,
  deleteUserAccount,
  listUsersWithOptions,
  updateUserProfile,
  type AdminCreateUserInput
} from '../services/user-management';

interface ProviderSecretPayload {
  provider: string;
  apiKey: string;
  label?: string;
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
    if (!event.body) {
      return badRequest('Request body is required');
    }

    const payload = parseJson<ProviderSecretPayload>(event.body);

    if (!payload.provider || !payload.apiKey) {
      return badRequest('provider and apiKey are required');
    }

    const secretId = await storeProviderApiKey(payload.provider, payload.apiKey);
    const config = await saveProviderConfig({
      provider: payload.provider,
      secretId,
      label: payload.label,
      status: 'active'
    });

    return ok({
      provider: config.provider,
      secretId: config.secretId,
      status: config.status,
      label: config.label
    });
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
