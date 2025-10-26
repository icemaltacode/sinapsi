import type { Handler } from 'aws-lambda';

import { listProviderConfigs } from '../repositories/providers';
import { testModelCapabilities } from '../services/model-capabilities';

/**
 * Lambda handler to test model capabilities for active providers
 * Invoked asynchronously by the model refresh Lambda
 *
 * Event payload can include:
 * - providerIds: string[] (optional) - specific provider IDs to test
 */
export const testCapabilities: Handler = async (event) => {
  console.log('[Capabilities] Starting capability testing');
  console.log('[Capabilities] Event:', JSON.stringify(event, null, 2));

  try {
    // Get all provider configs
    const allProviders = await listProviderConfigs();

    // Check if specific providers were requested
    const eventPayload = event as { providerIds?: string[] };
    const specificProviderIds = eventPayload.providerIds;

    let providersToTest = allProviders.filter((p) => p.status === 'active');

    // If specific provider IDs were requested, filter to only those
    if (specificProviderIds && specificProviderIds.length > 0) {
      console.log(`[Capabilities] Filtering to specific providers: ${specificProviderIds.join(', ')}`);
      providersToTest = providersToTest.filter((p) => specificProviderIds.includes(p.provider));
    }

    console.log(`[Capabilities] Testing capabilities for ${providersToTest.length} provider(s)`);

    if (providersToTest.length === 0) {
      console.log('[Capabilities] No providers to test');
      return;
    }

    // Test each provider's models sequentially to avoid rate limits
    for (const provider of providersToTest) {
      console.log(`[Capabilities] Testing provider: ${provider.provider}`);
      await testModelCapabilities(provider.provider);
    }

    console.log('[Capabilities] All capability testing complete');
  } catch (error) {
    console.error('[Capabilities] Error during capability testing:', error);
    throw error;
  }
};
