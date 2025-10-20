import { DeleteCommand, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';

import { docClient } from '../lib/clients';
import { baseItem, keys, type WebsocketConnectionItem } from '../lib/dynamo';
import { APP_TABLE_NAME } from '../lib/env';

const tableName = APP_TABLE_NAME;
const DEFAULT_TTL_SECONDS = 60 * 60 * 24; // 24 hours

export const registerConnection = async (input: {
  connectionId: string;
  userId: string;
}): Promise<WebsocketConnectionItem> => {
  const expiresAt = Math.floor(Date.now() / 1000) + DEFAULT_TTL_SECONDS;
  const item: WebsocketConnectionItem = {
    ...baseItem('WS_CONNECTION'),
    ...keys.websocketConnection(input.connectionId),
    connectionId: input.connectionId,
    userId: input.userId,
    expiresAt
  };

  await docClient.send(
    new PutCommand({
      TableName: tableName,
      Item: item
    })
  );

  return item;
};

export const deleteConnection = async (connectionId: string): Promise<void> => {
  const key = keys.websocketConnection(connectionId);
  await docClient.send(
    new DeleteCommand({
      TableName: tableName,
      Key: { pk: key.pk, sk: key.sk }
    })
  );
};

export const getConnection = async (
  connectionId: string
): Promise<WebsocketConnectionItem | null> => {
  const key = keys.websocketConnection(connectionId);
  const result = await docClient.send(
    new GetCommand({
      TableName: tableName,
      Key: { pk: key.pk, sk: key.sk }
    })
  );

  return (result.Item as WebsocketConnectionItem | undefined) ?? null;
};
