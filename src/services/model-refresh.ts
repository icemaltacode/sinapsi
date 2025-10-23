import OpenAI from 'openai';

import { curateModelList } from '../lib/baldrick';
import { getModelCache, saveModelCache, type ModelData } from '../repositories/model-cache';
import { getProviderConfig } from '../repositories/providers';

import { getProviderApiKey } from './provider-secrets';

export interface RefreshResult {
  success: boolean;
  modelsCount: number;
  error?: string;
}

/**
 * Refresh model cache for a specific provider
 */
export const refreshModelsForProvider = async (
  providerId: string
): Promise<RefreshResult> => {
  try {
    console.log(`[Model Refresh] Starting refresh for provider: ${providerId}`);

    // Get provider config
    const providerConfig = await getProviderConfig(providerId);
    if (!providerConfig) {
      const error = `Provider ${providerId} not found`;
      console.error(`[Model Refresh] ${error}`);
      return { success: false, modelsCount: 0, error };
    }

    if (providerConfig.status !== 'active') {
      const error = `Provider ${providerId} is not active (status: ${providerConfig.status})`;
      console.warn(`[Model Refresh] ${error}`);
      return { success: false, modelsCount: 0, error };
    }

    // Get API key
    const apiKey = await getProviderApiKey(providerId);

    // Fetch raw models from OpenAI API
    console.log(`[Model Refresh] Fetching models from OpenAI API`);
    const client = new OpenAI({ apiKey, timeout: 30000 });
    const response = await client.models.list();
    const rawModelIds = response.data.map((model) => model.id);

    console.log(`[Model Refresh] Fetched ${rawModelIds.length} raw models from API`);

    // Get existing cache to preserve blacklist and manual models
    const existingCache = await getModelCache(providerId);

    // Use Baldrick with GPT-5 to curate the list
    const curated = await curateModelList(rawModelIds, providerId, apiKey);

    if (curated.length === 0) {
      const error = 'Curation returned empty list - likely GPT-5 failed or returned invalid JSON';
      console.error(`[Model Refresh] ${error}`);
      return { success: false, modelsCount: 0, error };
    }

    // Build blacklist lookup from existing cache
    const blacklistMap = new Map<string, boolean>();
    existingCache?.models
      .filter((m) => m.blacklisted)
      .forEach((m) => blacklistMap.set(m.id, true));

    // Transform curated models and preserve blacklist flags
    // Set all capabilities to null - they will be tested by the capability checker Lambda
    const curatedModels: ModelData[] = curated.map((m) => ({
      id: m.model_name,
      label: m.display_name,
      supportsImageGeneration: null,
      supportsTTS: null,
      supportsTranscription: null,
      source: 'curated' as const,
      blacklisted: blacklistMap.get(m.model_name) || false
    }));

    // Preserve manual models from existing cache
    const manualModels = existingCache?.models.filter((m) => m.source === 'manual') || [];

    // Merge curated + manual
    const mergedModels = [...curatedModels, ...manualModels];

    console.log(`[Model Refresh] Merging ${curatedModels.length} curated + ${manualModels.length} manual models`);

    // Save to DynamoDB
    await saveModelCache(providerId, mergedModels, 'scheduled');

    console.log(`[Model Refresh] Successfully cached ${mergedModels.length} total models for ${providerId}`);
    console.log(`[Model Refresh] Curated models:`, curatedModels.map(m => m.id).join(', '));

    return { success: true, modelsCount: mergedModels.length };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`[Model Refresh] Failed to refresh models for ${providerId}:`, error);
    return { success: false, modelsCount: 0, error: errorMessage };
  }
};
