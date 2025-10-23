import type { Handler } from 'aws-lambda';

import { listProviderConfigs } from '../repositories/providers';
import { testModelCapabilities } from '../services/model-capabilities';

/**
 * Lambda handler to test model capabilities for all active OpenAI providers
 * Invoked asynchronously by the model refresh Lambda
 */
export const testCapabilities: Handler = async (event) => {
  console.log('[Capabilities] Starting capability testing');
  console.log('[Capabilities] Event:', JSON.stringify(event, null, 2));

  try {
    // Get all active OpenAI providers
    const providers = await listProviderConfigs();
    const openaiProviders = providers.filter(
      (p) => p.status === 'active' && (p.provider.includes('openai') || p.provider.includes('gpt'))
    );

    console.log(`[Capabilities] Testing capabilities for ${openaiProviders.length} providers`);

    // Test each provider's models sequentially to avoid rate limits
    for (const provider of openaiProviders) {
      console.log(`[Capabilities] Testing provider: ${provider.provider}`);
      await testModelCapabilities(provider.provider);
    }

    console.log('[Capabilities] All capability testing complete');
  } catch (error) {
    console.error('[Capabilities] Error during capability testing:', error);
    throw error;
  }
};
