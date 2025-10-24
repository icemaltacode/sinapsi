import OpenAI from 'openai';

import { curateModelList } from '../lib/baldrick';
import {
  getModelCache,
  saveModelCache,
  recordModelRefreshError,
  type ModelData
} from '../repositories/model-cache';
import { getProviderConfig } from '../repositories/providers';

import { getProviderApiKey } from './provider-secrets';

export interface RefreshResult {
  success: boolean;
  modelsCount: number;
  error?: string;
  rawModels?: string[];
  regexFilteredModels?: string[];
  curatedModels?: string[];
}

/**
 * Refresh model cache for a specific provider
 */
export const refreshModelsForProvider = async (
  providerId: string,
  trigger: 'scheduled' | 'manual'
): Promise<RefreshResult> => {
  let rawModelIds: string[] = [];
  let regexFilteredModelIds: string[] = [];
  let curatedModelIds: string[] = [];
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
    rawModelIds = response.data.map((model) => model.id);

    console.log(`[Model Refresh] Fetched ${rawModelIds.length} raw models from API`);
    console.log(`[Model Refresh] Raw models: ${rawModelIds.join(', ')}`);

    regexFilteredModelIds = rawModelIds.filter((id) => {
      const lower = id.toLowerCase();
      const hasDate = /\d{4}-\d{2}/.test(id);
      const hasPreview = lower.includes('preview');
      const isFineTuned = id.includes(':');
      const isEmbedding = lower.includes('embedding');
      const isAudio = lower.includes('tts') || lower.includes('audio');
      const isImageOnly = lower.includes('dall-e') || lower.startsWith('sora');
      const isModeration = lower.includes('moderation');
      const isRealtime = lower.includes('realtime');

      if (isFineTuned || isEmbedding || isAudio || isImageOnly || isModeration || isRealtime) {
        return false;
      }

      if (hasDate || hasPreview) {
        return false;
      }

      return true;
    });

    if (regexFilteredModelIds.length === 0) {
      console.warn('[Model Refresh] Regex filter removed all models; falling back to raw list');
      regexFilteredModelIds = [...rawModelIds];
    }

    console.log(
      `[Model Refresh] Regex filtered models (${rawModelIds.length} -> ${regexFilteredModelIds.length}): ${regexFilteredModelIds.join(', ')}`
    );

    // Get existing cache to preserve blacklist and manual models
    const existingCache = await getModelCache(providerId);

    // Use Baldrick with GPT-5 to curate the list
    const curated = await curateModelList(regexFilteredModelIds, providerId, apiKey);

    curatedModelIds = curated.map((m) => m.model_name);

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
      supportsFileUpload: null,
      source: 'curated' as const,
      blacklisted: blacklistMap.get(m.model_name) || false
    }));

    // Preserve manual models from existing cache
    const manualModels = existingCache?.models.filter((m) => m.source === 'manual') || [];

    // Merge curated + manual
    const mergedModels = [...curatedModels, ...manualModels];

    console.log(`[Model Refresh] Merging ${curatedModels.length} curated + ${manualModels.length} manual models`);

    // Save to DynamoDB
    await saveModelCache(providerId, mergedModels, trigger, {
      status: 'ok',
      errorMessage: null
    });

    console.log(`[Model Refresh] Successfully cached ${mergedModels.length} total models for ${providerId}`);
    console.log(`[Model Refresh] Curated models:`, curatedModels.map(m => m.id).join(', '));

    return {
      success: true,
      modelsCount: mergedModels.length,
      rawModels: rawModelIds,
      regexFilteredModels: regexFilteredModelIds,
      curatedModels: curatedModelIds
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`[Model Refresh] Failed to refresh models for ${providerId}:`, error);

    try {
      await recordModelRefreshError(providerId, trigger, errorMessage);
    } catch (recordError) {
      console.error(`[Model Refresh] Failed to record refresh error for ${providerId}:`, recordError);
    }

    throw error instanceof Error ? error : new Error(errorMessage);
  }
};
