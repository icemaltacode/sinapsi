import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';

/**
 * Provider adapter interface for model listing
 * Each provider implements its own way of fetching available models
 */
export interface ProviderAdapter {
  /**
   * Fetch raw model IDs from the provider's API
   */
  listModels(apiKey: string): Promise<string[]>;

  /**
   * Get the provider type identifier
   */
  getProviderType(): string;

  /**
   * Apply provider-specific filtering to raw model list before curation
   * This removes obviously irrelevant models (embeddings, audio, fine-tunes, etc.)
   */
  prefilterModels(rawModels: string[]): string[];
}

/**
 * OpenAI provider adapter
 */
class OpenAIAdapter implements ProviderAdapter {
  getProviderType(): string {
    return 'openai';
  }

  async listModels(apiKey: string): Promise<string[]> {
    console.log('[OpenAIAdapter] Fetching models from OpenAI API');
    const client = new OpenAI({ apiKey, timeout: 30000 });
    const response = await client.models.list();
    const models = response.data.map((model) => model.id);
    console.log(`[OpenAIAdapter] Fetched ${models.length} raw models`);
    return models;
  }

  prefilterModels(rawModels: string[]): string[] {
    const filtered = rawModels.filter((id) => {
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

    console.log(`[OpenAIAdapter] Prefiltered: ${rawModels.length} -> ${filtered.length} models`);
    return filtered;
  }
}

/**
 * Anthropic Claude provider adapter
 */
class ClaudeAdapter implements ProviderAdapter {
  getProviderType(): string {
    return 'claude';
  }

  async listModels(apiKey: string): Promise<string[]> {
    console.log('[ClaudeAdapter] Fetching models from Anthropic API');

    const client = new Anthropic({
      apiKey,
      timeout: 30000
    });

    // Fetch all pages of models
    const allModels: string[] = [];
    let hasMore = true;
    let afterId: string | undefined = undefined;

    while (hasMore) {
      const response = await client.models.list({
        limit: 100,
        after_id: afterId
      });

      // Extract model IDs
      const modelIds = response.data.map((model) => model.id);
      allModels.push(...modelIds);

      // Check pagination
      hasMore = response.has_more;
      afterId = response.last_id || undefined;

      console.log(`[ClaudeAdapter] Fetched page with ${modelIds.length} models, has_more=${hasMore}`);
    }

    console.log(`[ClaudeAdapter] Fetched ${allModels.length} total raw models`);
    return allModels;
  }

  prefilterModels(rawModels: string[]): string[] {
    // Claude models are generally well-named and don't have the same noise as OpenAI
    // But we still filter out any obvious non-chat models
    const filtered = rawModels.filter((id) => {
      const lower = id.toLowerCase();

      // Filter out embedding models if they exist
      if (lower.includes('embed')) {
        return false;
      }

      // Keep everything else - Claude's model list is much cleaner
      return true;
    });

    console.log(`[ClaudeAdapter] Prefiltered: ${rawModels.length} -> ${filtered.length} models`);
    return filtered;
  }
}

/**
 * Get the appropriate provider adapter based on provider type
 */
export function getProviderAdapter(providerType: string): ProviderAdapter {
  const normalized = providerType.toLowerCase();

  switch (normalized) {
    case 'openai':
      return new OpenAIAdapter();
    case 'claude':
      return new ClaudeAdapter();
    default:
      // Default to OpenAI for unknown providers (backward compatibility)
      console.warn(`[ProviderAdapter] Unknown provider type: ${providerType}, defaulting to OpenAI adapter`);
      return new OpenAIAdapter();
  }
}

/**
 * Detect provider type from provider ID (fallback for legacy data)
 */
export function detectProviderType(providerId: string): string {
  const lower = providerId.toLowerCase();

  if (lower.includes('claude')) {
    return 'claude';
  }
  if (lower.includes('openai') || lower.includes('gpt')) {
    return 'openai';
  }
  if (lower.includes('gemini')) {
    return 'gemini';
  }
  if (lower.includes('copilot')) {
    return 'copilot';
  }

  // Default to OpenAI
  return 'openai';
}
