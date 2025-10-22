import {
  BatchWriteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand
} from '@aws-sdk/lib-dynamodb';

import { docClient } from '../lib/clients';
import { baseItem, keys, touch, type SessionEventItem, type SessionSummaryItem } from '../lib/dynamo';
import { APP_TABLE_NAME } from '../lib/env';

const tableName = APP_TABLE_NAME;
const SESSION_PREFIX = 'SESSION#';

export interface CreateSessionInput {
  sessionId: string;
  userId: string;
  providerId: string;
  providerType: string;
  providerInstanceName: string;
  model: string;
  connectionId?: string;
}

export interface SaveMessageInput {
  sessionId: string;
  isoTimestamp: string;
  messageId: string;
  role: SessionEventItem['role'];
  content: string;
  imageUrl?: string;
  imagePrompt?: string;
  provider?: string;
  tokensIn?: number;
  tokensOut?: number;
  createdBy: string;
  eventType?: SessionEventItem['eventType'];
}

export interface ListSessionsOptions {
  userId: string;
  limit?: number;
  cursor?: string;
}

export interface ListSessionsResult {
  items: SessionSummaryItem[];
  nextCursor?: string;
}

const encodeCursor = (value: Record<string, unknown>) =>
  Buffer.from(JSON.stringify(value), 'utf8').toString('base64');

const decodeCursor = (cursor: string): Record<string, unknown> =>
  JSON.parse(Buffer.from(cursor, 'base64').toString('utf8'));

export const createSession = async (input: CreateSessionInput): Promise<SessionSummaryItem> => {
  const key = keys.sessionSummary(input.userId, input.sessionId);
  const item: SessionSummaryItem = {
    ...baseItem('SESSION_SUMMARY'),
    ...key,
    sessionId: input.sessionId,
    ownerUserId: input.userId,
    providerId: input.providerId,
    providerType: input.providerType,
    providerInstanceName: input.providerInstanceName,
    model: input.model,
    liveConnectionId: input.connectionId,
    title: undefined,
    participants: [input.userId],
    lastInteractionAt: new Date().toISOString(),
    pinned: false,
    status: 'active'
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

export const getSession = async (
  userId: string,
  sessionId: string
): Promise<SessionSummaryItem | null> => {
  const key = keys.sessionSummary(userId, sessionId);
  const result = await docClient.send(
    new GetCommand({
      TableName: tableName,
      Key: { pk: key.pk, sk: key.sk }
    })
  );

  return (result.Item as SessionSummaryItem | undefined) ?? null;
};

export const updateSessionMetadata = async (
  session: SessionSummaryItem,
  updates: Partial<
    Pick<
      SessionSummaryItem,
      'title' | 'lastInteractionAt' | 'model' | 'status' | 'pinned' | 'liveConnectionId'
    >
  >
): Promise<SessionSummaryItem> => {
  const next: SessionSummaryItem = {
    ...touch(session),
    ...updates
  };

  await docClient.send(
    new UpdateCommand({
      TableName: tableName,
      Key: { pk: session.pk, sk: session.sk },
      UpdateExpression:
        'SET title = :title, lastInteractionAt = :lastInteractionAt, model = :model, #status = :status, pinned = :pinned, liveConnectionId = :liveConnectionId, updatedAt = :updatedAt, #version = :version',
      ConditionExpression: '#version = :expectedVersion',
      ExpressionAttributeNames: {
        '#status': 'status',
        '#version': 'version'
      },
      ExpressionAttributeValues: {
        ':title': next.title ?? null,
        ':lastInteractionAt': next.lastInteractionAt,
        ':model': next.model,
        ':status': next.status,
        ':pinned': next.pinned,
        ':liveConnectionId': next.liveConnectionId ?? null,
        ':updatedAt': next.updatedAt,
        ':version': next.version,
        ':expectedVersion': session.version
      }
    })
  );

  return next;
};

export const listSessions = async ({
  userId,
  limit,
  cursor
}: ListSessionsOptions): Promise<ListSessionsResult> => {
  const exclusiveStartKey = cursor ? decodeCursor(cursor) : undefined;

  const result = await docClient.send(
    new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)',
      ExpressionAttributeValues: {
        ':pk': keys.sessionSummary(userId, 'placeholder').pk,
        ':prefix': SESSION_PREFIX
      },
      Limit: limit,
      ExclusiveStartKey: exclusiveStartKey
    })
  );

  const items = (result.Items as SessionSummaryItem[] | undefined) ?? [];

  return {
    items,
    nextCursor: result.LastEvaluatedKey ? encodeCursor(result.LastEvaluatedKey) : undefined
  };
};

export const saveMessage = async (input: SaveMessageInput): Promise<SessionEventItem> => {
  const key = keys.sessionEvent(input.sessionId, input.isoTimestamp);
  const item: SessionEventItem = {
    ...baseItem('SESSION_EVENT'),
    ...key,
    sessionId: input.sessionId,
    eventType: input.eventType ?? 'message',
    messageId: input.messageId,
    role: input.role,
    content: input.content,
    imageUrl: input.imageUrl,
    imagePrompt: input.imagePrompt,
    provider: input.provider,
    tokensIn: input.tokensIn,
    tokensOut: input.tokensOut,
    createdBy: input.createdBy
  };

  await docClient.send(
    new PutCommand({
      TableName: tableName,
      Item: item
    })
  );

  return item;
};

export const listMessages = async (sessionId: string): Promise<SessionEventItem[]> => {
  const result = await docClient.send(
    new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)',
      ExpressionAttributeValues: {
        ':pk': keys.sessionEvent(sessionId, 'placeholder').pk,
        ':prefix': 'EVENT#'
      }
    })
  );

  return (result.Items as SessionEventItem[] | undefined) ?? [];
};

export const deleteSession = async (session: SessionSummaryItem): Promise<void> => {
  const events = await listMessages(session.sessionId);
  const deleteRequests = [
    {
      DeleteRequest: {
        Key: { pk: session.pk, sk: session.sk }
      }
    },
    ...events.map((event) => ({
      DeleteRequest: {
        Key: { pk: event.pk, sk: event.sk }
      }
    }))
  ];

  for (let i = 0; i < deleteRequests.length; i += 25) {
    const chunk = deleteRequests.slice(i, i + 25);
    await docClient.send(
      new BatchWriteCommand({
        RequestItems: {
          [tableName]: chunk
        }
      })
    );
  }
};
