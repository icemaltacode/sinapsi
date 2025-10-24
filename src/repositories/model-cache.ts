import { GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';

import { docClient } from '../lib/clients';
import { baseItem, keys, touch, type ModelCacheItem } from '../lib/dynamo';
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
  source: 'scheduled' | 'manual',
  options: {
    status?: 'ok' | 'error';
    errorMessage?: string | null;
  } = {}
): Promise<ModelCacheItem> => {
  const key = keys.modelCache(provider);
  const now = new Date().toISOString();

  const item: ModelCacheItem = {
    ...baseItem('MODEL_CACHE'),
    ...key,
    provider,
    models,
    lastRefreshed: now,
    refreshSource: source,
    lastRefreshAttempt: now,
    lastRefreshStatus: options.status ?? 'ok',
    lastRefreshError: options.errorMessage ?? null
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
  const now = new Date().toISOString();

  // Get existing cache to preserve lastRefreshed and refreshSource
  const existingCache = await getModelCache(provider);
  if (!existingCache) {
    throw new Error(`No existing cache found for provider ${provider}`);
  }

  const item: ModelCacheItem = {
    ...existingCache,
    models,
    capabilitiesRefreshed: now,
    lastRefreshStatus: existingCache.lastRefreshStatus ?? 'ok',
    lastRefreshError: existingCache.lastRefreshError ?? null
  };

  await docClient.send(
    new PutCommand({
      TableName: tableName,
      Item: item
    })
  );
};

export const updateModelCapabilityEntry = async (
  provider: string,
  updatedModel: ModelData
): Promise<void> => {
  const cache = await getModelCache(provider);
  if (!cache) {
    throw new Error(`No existing cache found for provider ${provider}`);
  }

  const models = cache.models.map((model) =>
    model.id === updatedModel.id
      ? {
          ...model,
          supportsImageGeneration: updatedModel.supportsImageGeneration,
          supportsTTS: updatedModel.supportsTTS,
          supportsTranscription: updatedModel.supportsTranscription,
          supportsFileUpload: updatedModel.supportsFileUpload
        }
      : model
  );

  const item: ModelCacheItem = {
    ...touch(cache),
    models,
    capabilitiesRefreshed: new Date().toISOString()
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

export const recordModelRefreshError = async (
  provider: string,
  source: 'scheduled' | 'manual',
  errorMessage: string
): Promise<void> => {
  const existingCache = await getModelCache(provider);
  const now = new Date().toISOString();

  if (!existingCache) {
    const emptyCache: ModelCacheItem = {
      ...baseItem('MODEL_CACHE'),
      ...keys.modelCache(provider),
      provider,
      models: [],
      lastRefreshed: now,
      refreshSource: source,
      lastRefreshAttempt: now,
      lastRefreshStatus: 'error',
      lastRefreshError: errorMessage
    };

    await docClient.send(
      new PutCommand({
        TableName: tableName,
        Item: emptyCache
      })
    );
    return;
  }

  const updated: ModelCacheItem = {
    ...touch(existingCache),
    lastRefreshAttempt: now,
    lastRefreshStatus: 'error',
    lastRefreshError: errorMessage,
    refreshSource: source
  };

  await docClient.send(
    new PutCommand({
      TableName: tableName,
      Item: updated
    })
  );
};
