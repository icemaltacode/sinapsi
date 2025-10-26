import { getCapabilityAdapter } from '../lib/capability-adapters';
import { detectProviderType } from '../lib/provider-adapters';
import {
  getModelCache,
  saveModelCapabilities,
  updateModelCapabilityEntry,
  type ModelData
} from '../repositories/model-cache';
import { getProviderConfig } from '../repositories/providers';

import { getProviderApiKey } from './provider-secrets';

/**
 * Test model capabilities for a specific provider
 * Updates DynamoDB with the results
 */
export async function testModelCapabilities(providerId: string): Promise<void> {
  console.log(`[Capabilities] Starting capability testing for provider: ${providerId}`);

  try {
    // Get provider config to determine provider type
    const providerConfig = await getProviderConfig(providerId);
    if (!providerConfig) {
      console.error(`[Capabilities] Provider ${providerId} not found`);
      return;
    }

    // Determine provider type and get appropriate adapter
    const providerType = providerConfig.providerType || detectProviderType(providerId);
    console.log(`[Capabilities] Provider type: ${providerType}`);

    const adapter = getCapabilityAdapter(providerType);

    // Get API key from Secrets Manager
    const apiKey = await getProviderApiKey(providerId);

    // Get current model cache
    const cache = await getModelCache(providerId);
    if (!cache || !cache.models.length) {
      console.log(`[Capabilities] No models found in cache for ${providerId}`);
      return;
    }

    console.log(`[Capabilities] Testing capabilities for ${cache.models.length} models`);

    const updatedModels: ModelData[] = [];

    for (const model of cache.models) {
      console.log(`[Capabilities] Testing ${model.id}...`);

      try {
        const capabilities = await adapter.testCapabilities(model.id, apiKey);

        const updatedModel: ModelData = {
          ...model,
          supportsImageGeneration: capabilities.supportsImageGeneration,
          supportsTTS: capabilities.supportsTTS,
          supportsTranscription: capabilities.supportsTranscription,
          supportsFileUpload: capabilities.supportsFileUpload
        };

        updatedModels.push(updatedModel);

        try {
          await updateModelCapabilityEntry(providerId, updatedModel);
          console.log(
            `[Capabilities] Persisted capability update for ${model.id}: img=${capabilities.supportsImageGeneration}, tts=${capabilities.supportsTTS}, asr=${capabilities.supportsTranscription}, files=${capabilities.supportsFileUpload}`
          );
        } catch (updateError) {
          console.error(`[Capabilities] Failed to persist capability update for ${model.id}:`, updateError);
        }
      } catch (testError) {
        console.error(`[Capabilities] Error testing ${model.id}:`, testError);
        // Keep the model with null capabilities on error
        updatedModels.push(model);
      }
    }

    await saveModelCapabilities(providerId, updatedModels);

    console.log(`[Capabilities] Updated ${updatedModels.length} models for ${providerId}`);
  } catch (error) {
    console.error(`[Capabilities] Error testing capabilities for ${providerId}:`, error);
    throw error;
  }
}
