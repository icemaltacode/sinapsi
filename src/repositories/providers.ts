import { GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';

import { docClient } from '../lib/clients';
import { baseItem, keys, touch, type ProviderConfigItem } from '../lib/dynamo';
import { APP_TABLE_NAME } from '../lib/env';

const tableName = APP_TABLE_NAME;

export interface SaveProviderConfigInput {
  provider: string;
  secretId: string;
  label?: string;
  status?: ProviderConfigItem['status'];
}

export const getProviderConfig = async (provider: string): Promise<ProviderConfigItem | null> => {
  const key = keys.providerConfig(provider);
  const result = await docClient.send(
    new GetCommand({
      TableName: tableName,
      Key: { pk: key.pk, sk: key.sk }
    })
  );

  return (result.Item as ProviderConfigItem | undefined) ?? null;
};

export const saveProviderConfig = async (
  input: SaveProviderConfigInput
): Promise<ProviderConfigItem> => {
  const existing = await getProviderConfig(input.provider);
  const now = new Date().toISOString();

  if (existing) {
    const updated: ProviderConfigItem = {
      ...touch(existing),
      secretId: input.secretId,
      label: input.label ?? existing.label,
      status: input.status ?? existing.status,
      lastRotatedAt: now
    };

    await docClient.send(
      new PutCommand({
        TableName: tableName,
        Item: updated
      })
    );

    return updated;
  }

  const item: ProviderConfigItem = {
    ...baseItem('PROVIDER_CONFIG'),
    ...keys.providerConfig(input.provider),
    provider: input.provider,
    secretId: input.secretId,
    label: input.label,
    status: input.status ?? 'active',
    lastRotatedAt: now
  };

  await docClient.send(
    new PutCommand({
      TableName: tableName,
      Item: item
    })
  );

  return item;
};
