import {
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand
} from '@aws-sdk/lib-dynamodb';

import { docClient } from '../lib/clients';
import { TENANT_ID, baseItem, keys, touch, type UserProfileItem } from '../lib/dynamo';
import { APP_TABLE_NAME } from '../lib/env';

type UserRole = UserProfileItem['role'];

export interface CreateUserInput {
  userId: string;
  email: string;
  displayName: string;
  role: UserRole;
  cognitoSub?: string;
  isActive?: boolean;
  firstName?: string;
  lastName?: string;
  avatarKey?: string;
}

export interface UpdateUserInput {
  userId: string;
  displayName?: string;
  role?: UserRole;
  cognitoSub?: string | null;
  isActive?: boolean;
  firstName?: string | null;
  lastName?: string | null;
  avatarKey?: string | null;
}

export interface ListUsersInput {
  limit?: number;
  cursor?: string;
  search?: string;
}

export interface ListUsersOutput {
  items: UserProfileItem[];
  nextCursor?: string;
}

const tableName = APP_TABLE_NAME;

const normaliseEmail = (email: string) => email.trim().toLowerCase();

const encodeCursor = (key: Record<string, unknown>) =>
  Buffer.from(JSON.stringify(key), 'utf8').toString('base64');

const decodeCursor = (cursor: string): Record<string, unknown> =>
  JSON.parse(Buffer.from(cursor, 'base64').toString('utf8'));

export const createUser = async (input: CreateUserInput): Promise<UserProfileItem> => {
  const email = normaliseEmail(input.email);
  const key = keys.userProfile(input.userId, email);
  const item: UserProfileItem = {
    ...baseItem('USER_PROFILE'),
    ...key,
    userId: input.userId,
    email,
    displayName: input.displayName,
    role: input.role,
    cognitoSub: input.cognitoSub,
    firstName: input.firstName,
    lastName: input.lastName,
    avatarKey: input.avatarKey,
    isActive: input.isActive ?? true
  };

  await docClient.send(
    new PutCommand({
      TableName: tableName,
      Item: item,
      ConditionExpression: 'attribute_not_exists(pk) AND attribute_not_exists(sk)'
    })
  );

  return item;
};

export const getUserById = async (userId: string): Promise<UserProfileItem | null> => {
  const key = keys.userProfile(userId);
  const result = await docClient.send(
    new GetCommand({
      TableName: tableName,
      Key: { pk: key.pk, sk: key.sk }
    })
  );

  return (result.Item as UserProfileItem | undefined) ?? null;
};

export const getUserByEmail = async (email: string): Promise<UserProfileItem | null> => {
  const result = await docClient.send(
    new QueryCommand({
      TableName: tableName,
      IndexName: 'GSI2',
      KeyConditionExpression: 'gsi2pk = :gsi2pk AND gsi2sk = :gsi2sk',
      ExpressionAttributeValues: {
        ':gsi2pk': `USER_EMAIL#ice-campus`,
        ':gsi2sk': normaliseEmail(email)
      },
      Limit: 1
    })
  );

  if (!result.Items?.length) {
    return null;
  }

  return result.Items[0] as UserProfileItem;
};

export const getUserByCognitoSub = async (
  cognitoSub: string
): Promise<UserProfileItem | null> => {
  const result = await docClient.send(
    new QueryCommand({
      TableName: tableName,
      IndexName: 'GSI1',
      KeyConditionExpression: 'gsi1pk = :profile',
      FilterExpression: 'cognitoSub = :sub',
      ExpressionAttributeValues: {
        ':profile': 'PROFILE',
        ':sub': cognitoSub
      },
      Limit: 1
    })
  );

  if (!result.Items?.length) {
    return null;
  }

  return result.Items[0] as UserProfileItem;
};

export const updateUser = async (input: UpdateUserInput): Promise<UserProfileItem | null> => {
  const existing = await getUserById(input.userId);
  if (!existing) {
    return null;
  }

  const next: UserProfileItem = {
    ...touch(existing),
    displayName: input.displayName ?? existing.displayName,
    role: input.role ?? existing.role,
    cognitoSub:
      input.cognitoSub === undefined
        ? existing.cognitoSub
        : input.cognitoSub === null
          ? undefined
          : input.cognitoSub,
    isActive: input.isActive ?? existing.isActive,
    firstName:
      input.firstName === undefined
        ? existing.firstName
        : input.firstName === null
          ? undefined
          : input.firstName,
    lastName:
      input.lastName === undefined
        ? existing.lastName
        : input.lastName === null
          ? undefined
          : input.lastName,
    avatarKey:
      input.avatarKey === undefined
        ? existing.avatarKey
        : input.avatarKey === null
          ? undefined
          : input.avatarKey
  };

  await docClient.send(
    new UpdateCommand({
      TableName: tableName,
      Key: { pk: existing.pk, sk: existing.sk },
      UpdateExpression:
        'SET displayName = :displayName, #role = :role, cognitoSub = :cognitoSub, isActive = :isActive, firstName = :firstName, lastName = :lastName, avatarKey = :avatarKey, updatedAt = :updatedAt, #version = :nextVersion',
      ConditionExpression: '#version = :expectedVersion',
      ExpressionAttributeNames: {
        '#role': 'role',
        '#version': 'version'
      },
      ExpressionAttributeValues: {
        ':displayName': next.displayName,
        ':role': next.role,
        ':cognitoSub': next.cognitoSub ?? null,
        ':isActive': next.isActive,
        ':firstName': next.firstName ?? null,
        ':lastName': next.lastName ?? null,
        ':avatarKey': next.avatarKey ?? null,
        ':updatedAt': next.updatedAt,
        ':nextVersion': next.version,
        ':expectedVersion': existing.version
      }
    })
  );

  return next;
};

export const listUsers = async ({
  limit = 20,
  cursor,
  search
}: ListUsersInput): Promise<ListUsersOutput> => {
  const safeLimit = Math.min(Math.max(limit, 1), 100);
  const exclusiveStartKey = cursor ? decodeCursor(cursor) : undefined;

  const result = await docClient.send(
    new QueryCommand(
      search
        ? {
            TableName: tableName,
            IndexName: 'GSI2',
            KeyConditionExpression:
              'gsi2pk = :tenant AND begins_with(gsi2sk, :search)',
            ExpressionAttributeValues: {
              ':tenant': `USER_EMAIL#${TENANT_ID}`,
              ':search': normaliseEmail(search)
            },
            Limit: safeLimit,
            ExclusiveStartKey: exclusiveStartKey
          }
        : {
            TableName: tableName,
            IndexName: 'GSI1',
            KeyConditionExpression:
              'gsi1pk = :profile AND begins_with(gsi1sk, :tenantKey)',
            ExpressionAttributeValues: {
              ':profile': 'PROFILE',
              ':tenantKey': `${TENANT_ID}#`
            },
            Limit: safeLimit,
            ExclusiveStartKey: exclusiveStartKey
          }
    )
  );

  return {
    items: (result.Items ?? []) as UserProfileItem[],
    nextCursor: result.LastEvaluatedKey ? encodeCursor(result.LastEvaluatedKey) : undefined
  };
};

export const deleteUser = async (userId: string): Promise<void> => {
  const profileKey = keys.userProfile(userId);

  await docClient.send(
    new DeleteCommand({
      TableName: tableName,
      Key: { pk: profileKey.pk, sk: profileKey.sk }
    })
  );

  const quotas = await docClient.send(
    new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: 'pk = :pk AND begins_with(sk, :sk)',
      ExpressionAttributeValues: {
        ':pk': `TENANT#${TENANT_ID}`,
        ':sk': `QUOTA#${userId}#`
      }
    })
  );

  if (quotas.Items?.length) {
    await Promise.all(
      quotas.Items.map((item) =>
        docClient.send(
          new DeleteCommand({
            TableName: tableName,
            Key: { pk: item.pk as string, sk: item.sk as string }
          })
        )
      )
    );
  }
};
