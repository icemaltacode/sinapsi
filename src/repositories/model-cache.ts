import { GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';

import { docClient } from '../lib/clients';
import { baseItem, keys, type ModelCacheItem } from '../lib/dynamo';
import { APP_TABLE_NAME } from '../lib/env';

const tableName = APP_TABLE_NAME;

const CACHE_STALE_THRESHOLD_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export interface ModelData {
  id: string;
  label: string;
  supportsImageGeneration: boolean | null;
  supportsTTS?: boolean | null;
  supportsTranscription?: boolean | null;
  supportsFileUpload?: boolean | null;
  source: 'curated' | 'manual';
  blacklisted?: boolean;
}

/**
 * Get cached model list for a provider
 */
export const getModelCache = async (provider: string): Promise<ModelCacheItem | null> => {
  const key = keys.modelCache(provider);

  const result = await docClient.send(
    new GetCommand({
      TableName: tableName,
      Key: { pk: key.pk, sk: key.sk }
    })
  );

  return (result.Item as ModelCacheItem | undefined) ?? null;
};

/**
 * Save model cache for a provider
 */
export const saveModelCache = async (
  provider: string,
  models: ModelData[],
  source: 'scheduled' | 'manual'
): Promise<ModelCacheItem> => {
  const key = keys.modelCache(provider);
  const now = new Date().toISOString();

  const item: ModelCacheItem = {
    ...baseItem('MODEL_CACHE'),
    ...key,
    provider,
    models,
    lastRefreshed: now,
    refreshSource: source
  };

  await docClient.send(
    new PutCommand({
      TableName: tableName,
      Item: item
    })
  );

  return item;
};

/**
 * Save model capabilities and update capabilitiesRefreshed timestamp
 */
export const saveModelCapabilities = async (
  provider: string,
  models: ModelData[]
): Promise<void> => {
  const key = keys.modelCache(provider);
  const now = new Date().toISOString();

  // Get existing cache to preserve lastRefreshed and refreshSource
  const existingCache = await getModelCache(provider);
  if (!existingCache) {
    throw new Error(`No existing cache found for provider ${provider}`);
  }

  const item: ModelCacheItem = {
    ...existingCache,
    models,
    capabilitiesRefreshed: now
  };

  await docClient.send(
    new PutCommand({
      TableName: tableName,
      Item: item
    })
  );
};

/**
 * Check if cache is stale (older than 7 days)
 */
export const isCacheStale = (cache: ModelCacheItem): boolean => {
  const refreshedAt = new Date(cache.lastRefreshed).getTime();
  const now = Date.now();
  return now - refreshedAt > CACHE_STALE_THRESHOLD_MS;
};
