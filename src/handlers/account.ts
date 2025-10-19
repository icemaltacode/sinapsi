import crypto from 'crypto';

import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { APIGatewayEventRequestContextV2, APIGatewayProxyHandlerV2 } from 'aws-lambda';

import type { UserProfileItem } from '../lib/dynamo';
import { getEnv } from '../lib/env';
import { badRequest, ok, serverError } from '../lib/response';
import { ensureDefaultQuotas } from '../repositories/quotas';
import { createUser, getUserByCognitoSub, getUserById, updateUser } from '../repositories/users';
import { updateCognitoUserAttributes } from '../services/cognito';

const AVATAR_BUCKET = getEnv('AVATAR_BUCKET');
const s3Client = new S3Client({});

interface ProfileUpdatePayload {
  displayName?: string;
  firstName?: string;
  lastName?: string;
}

const parseJson = <T>(body: string): T => JSON.parse(body);

type RequestContextWithAuthorizer = APIGatewayEventRequestContextV2 & {
  authorizer?: {
    jwt?: {
      claims?: Record<string, unknown>;
    };
  };
};

const getSubFromContext = (event: Parameters<APIGatewayProxyHandlerV2>[0]) => {
  const context = event.requestContext as RequestContextWithAuthorizer;
  return context.authorizer?.jwt?.claims?.sub as string | undefined;
};

export const profile: APIGatewayProxyHandlerV2 = async (event) => {
  try {
    const sub = getSubFromContext(event);
    if (!sub) {
      return badRequest('Missing user identity');
    }

    const claims = (event.requestContext as RequestContextWithAuthorizer).authorizer?.jwt?.claims ?? {};
    const preferredUserId = claims.preferred_username as string | undefined;
    const emailClaim = claims.email as string | undefined;
    const displayNameClaim = (claims.name as string | undefined) ?? emailClaim;
    const roleClaim = (claims['custom:role'] as string | undefined) === 'admin' ? 'admin' : 'student';
    const firstNameClaim = claims.given_name as string | undefined;
    const lastNameClaim = claims.family_name as string | undefined;

    let existing: UserProfileItem | null = null;
    if (preferredUserId) {
      existing = await getUserById(preferredUserId);
    }
    if (!existing) {
      existing = await getUserByCognitoSub(sub);
    }

    if (!existing) {
      if (!emailClaim) {
        return badRequest('Profile not found');
      }

      const userIdClaim = preferredUserId ?? sub;
      const created = await createUser({
        userId: userIdClaim,
        email: emailClaim,
        displayName: displayNameClaim,
        role: roleClaim,
        cognitoSub: sub,
        isActive: true,
        firstName: firstNameClaim,
        lastName: lastNameClaim
      });

      await ensureDefaultQuotas(created.userId);
      existing = created;
    } else if (!existing.cognitoSub) {
      await updateUser({ userId: existing.userId, cognitoSub: sub });
      existing.cognitoSub = sub;
    }

    const userId = existing.userId;

    if (event.requestContext.http.method === 'GET') {
      return ok({
        user: {
          userId,
          email: existing.email,
          displayName: existing.displayName,
          firstName: existing.firstName ?? '',
          lastName: existing.lastName ?? '',
          avatarKey: existing.avatarKey ?? null
        }
      });
    }

    if (!event.body) {
      return badRequest('Request body is required');
    }

    const payload = parseJson<ProfileUpdatePayload>(event.body);
    const displayName = payload.displayName ?? existing.displayName;
    const firstName = payload.firstName ?? existing.firstName ?? undefined;
    const lastName = payload.lastName ?? existing.lastName ?? undefined;

    const updated = await updateUser({
      userId,
      displayName,
      firstName,
      lastName
    });

    if (!updated) {
      throw new Error('Failed to update profile');
    }

    await updateCognitoUserAttributes(existing.email, {
      displayName,
      firstName,
      lastName
    });

    return ok({
      user: {
        userId: updated.userId,
        email: updated.email,
        displayName: updated.displayName,
        firstName: updated.firstName ?? '',
        lastName: updated.lastName ?? '',
        avatarKey: updated.avatarKey ?? null
      }
    });
  } catch (error) {
    console.error('account.profile error', error);
    return serverError(error);
  }
};

export const avatarUpload: APIGatewayProxyHandlerV2 = async (event) => {
  try {
    const sub = getSubFromContext(event);
    if (!sub) {
      return badRequest('Missing user identity');
    }

    const existing = (await getUserById(sub)) ?? (await getUserByCognitoSub(sub));
    if (!existing) {
      return badRequest('Profile not found');
    }

    const userId = existing.userId;

    if (!event.body) {
      return badRequest('Request body is required');
    }

    const { contentType } = parseJson<{ contentType?: string }>(event.body);

    if (!contentType || !contentType.startsWith('image/')) {
      return badRequest('contentType must be an image mime type');
    }

    const ext = contentType.split('/')[1] ?? 'jpg';
    const key = `avatars/${userId}/${crypto.randomUUID()}.${ext}`;

    const command = new PutObjectCommand({
      Bucket: AVATAR_BUCKET,
      Key: key,
      ContentType: contentType,
      ACL: 'public-read'
    });

    const url = await getSignedUrl(s3Client, command, { expiresIn: 300 });

    await updateUser({ userId, avatarKey: key });

    return ok({ uploadUrl: url, key });
  } catch (error) {
    console.error('account.avatarUpload error', error);
    return serverError(error);
  }
};
