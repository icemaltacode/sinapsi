import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda';
import { PublishCommand, SNSClient } from '@aws-sdk/client-sns';
import type { ScheduledHandler } from 'aws-lambda';

import { USAGE_TOPIC_ARN } from '../lib/env';
import { listProviderConfigs } from '../repositories/providers';
import { refreshModelsForProvider } from '../services/model-refresh';

const snsClient = new SNSClient({});
const lambdaClient = new LambdaClient({});

/**
 * Scheduled Lambda to refresh model cache for all active OpenAI providers
 * Runs daily via EventBridge cron
 */
export const refreshModelCache: ScheduledHandler = async (event) => {
  console.log('[Scheduled Model Refresh] Starting daily model cache refresh');
  console.log('[Scheduled Model Refresh] Event:', JSON.stringify(event, null, 2));

  try {
    // Get all provider configs
    const providers = await listProviderConfigs();
    console.log(`[Scheduled Model Refresh] Found ${providers.length} total providers`);

    // Filter to only active OpenAI providers
    const openaiProviders = providers.filter(
      (p) => p.status === 'active' && (p.provider.includes('openai') || p.provider.includes('gpt'))
    );

    console.log(`[Scheduled Model Refresh] Found ${openaiProviders.length} active OpenAI providers`);

    if (openaiProviders.length === 0) {
      console.log('[Scheduled Model Refresh] No active OpenAI providers to refresh');
      return;
    }

    const trigger: 'scheduled' | 'manual' =
      'detail-type' in event ? 'scheduled' : (event as { manual?: boolean })?.manual ? 'manual' : 'scheduled';

    // Refresh each provider
    const results = await Promise.all(
      openaiProviders.map(async (provider) => {
        const result = await refreshModelsForProvider(provider.provider, trigger);
        return {
          providerId: provider.provider,
          ...result
        };
      })
    );

    for (const result of results) {
      if (result.rawModels && result.rawModels.length > 0) {
        console.log(`[Scheduled Model Refresh] Raw models for ${result.providerId}: ${result.rawModels.join(', ')}`);
      } else {
        console.log(`[Scheduled Model Refresh] Raw models for ${result.providerId}: (none)`);
      }

      if (result.regexFilteredModels && result.regexFilteredModels.length > 0) {
        console.log(
          `[Scheduled Model Refresh] Regex filtered models for ${result.providerId}: ${result.regexFilteredModels.join(', ')}`
        );
      } else {
        console.log(`[Scheduled Model Refresh] Regex filtered models for ${result.providerId}: (none)`);
      }

      if (result.curatedModels && result.curatedModels.length > 0) {
        console.log(`[Scheduled Model Refresh] Curated models for ${result.providerId}: ${result.curatedModels.join(', ')}`);
      } else {
        console.log(`[Scheduled Model Refresh] Curated models for ${result.providerId}: (none)`);
      }
    }

    // Collect statistics
    const successful = results.filter((r) => r.success);
    const failed = results.filter((r) => !r.success);

    console.log(`[Scheduled Model Refresh] Summary: ${successful.length} succeeded, ${failed.length} failed`);

    // If any failures, send alert
    if (failed.length > 0) {
      const message = `Daily model cache refresh completed with ${failed.length} failure(s):

${failed.map((f) => `- Provider: ${f.providerId}\n  Error: ${f.error}`).join('\n\n')}

Successful refreshes: ${successful.length}
${successful.map((s) => `- ${s.providerId}: ${s.modelsCount} models cached`).join('\n')}`;

      console.error('[Scheduled Model Refresh] Sending failure alert via SNS');

      await snsClient.send(
        new PublishCommand({
          TopicArn: USAGE_TOPIC_ARN,
          Subject: `Sinapsi: Model Cache Refresh Failed (${failed.length} provider${failed.length === 1 ? '' : 's'})`,
          Message: message
        })
      );
    } else {
      console.log('[Scheduled Model Refresh] All providers refreshed successfully');
      console.log(
        `[Scheduled Model Refresh] Total models cached: ${successful.reduce((sum, r) => sum + r.modelsCount, 0)}`
      );

      const functionName = `sinapsi-${process.env.STAGE || 'dev'}-testCapabilities`;
      console.log('[Scheduled Model Refresh] Invoking capability checker Lambda');

      await lambdaClient.send(
        new InvokeCommand({
          FunctionName: functionName,
          InvocationType: 'Event', // Async invocation
          Payload: JSON.stringify({})
        })
      );

      console.log('[Scheduled Model Refresh] Capability testing started in background');
    }
  } catch (error) {
    console.error('[Scheduled Model Refresh] Unexpected error during refresh:', error);

    // Send critical failure alert
    await snsClient.send(
      new PublishCommand({
        TopicArn: USAGE_TOPIC_ARN,
        Subject: 'Sinapsi: Model Cache Refresh Critical Failure',
        Message: `Daily model cache refresh failed with unexpected error:

${error instanceof Error ? error.message : String(error)}

Stack trace:
${error instanceof Error ? error.stack : 'N/A'}`
      })
    );

    throw error;
  }
};
