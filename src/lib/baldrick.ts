import OpenAI from 'openai';

import { getEnv } from './env';

/**
 * Baldrick - The loyal AI servant for simple, quick inference tasks.
 * Uses a cheap, fast model for basic classification, extraction, and analysis.
 */

const BALDRICK_MODEL = getEnv('BALDRICK_MODEL', 'gpt-4o-mini');

/**
 * Log a message from Baldrick with consistent prefix
 */
const baldrickLog = (message: string, ...args: unknown[]) => {
  console.log(`[Baldrick] ${message}`, ...args);
};

/**
 * Ask Baldrick a simple question and get a text response
 */
export const askBaldrick = async (
  prompt: string,
  apiKey: string,
  options: {
    systemPrompt?: string;
    maxTokens?: number;
    temperature?: number;
    timeout?: number;
  } = {}
): Promise<string> => {
  const {
    systemPrompt,
    maxTokens = 50,
    temperature = 0,
    timeout = 5000
  } = options;

  try {
    baldrickLog(`Asking: ${prompt.substring(0, 100)}${prompt.length > 100 ? '...' : ''}`);

    const client = new OpenAI({ apiKey, timeout });

    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [];
    if (systemPrompt) {
      messages.push({ role: 'system', content: systemPrompt });
    }
    messages.push({ role: 'user', content: prompt });

    const response = await client.chat.completions.create({
      model: BALDRICK_MODEL,
      messages,
      temperature,
      max_tokens: maxTokens
    });

    const answer = response.choices[0]?.message?.content?.trim() || '';
    baldrickLog(`Answer: ${answer}`);

    return answer;
  } catch (error) {
    baldrickLog('Error:', error);
    throw error;
  }
};

/**
 * Ask Baldrick to classify something into one of the provided options
 * Returns the matched option or a fallback value
 */
export const askBaldrickToClassify = async <T extends string>(
  prompt: string,
  apiKey: string,
  options: readonly T[],
  fallback: T
): Promise<T> => {
  try {
    baldrickLog(`Classifying into: [${options.join(', ')}]`);

    const answer = await askBaldrick(
      `${prompt}. Answer with only one word: ${options.join(', ')}`,
      apiKey,
      { maxTokens: 5, temperature: 0 }
    );

    const normalized = answer.toLowerCase() as T;

    if (options.includes(normalized)) {
      baldrickLog(`Classification result: ${normalized}`);
      return normalized;
    }

    baldrickLog(`Invalid answer "${answer}", using fallback: ${fallback}`);
    return fallback;
  } catch {
    baldrickLog(`Classification failed, using fallback: ${fallback}`);
    return fallback;
  }
};

/**
 * Detect the optimal aspect ratio for an image based on its description
 */
export const detectImageAspectRatio = async (
  imagePrompt: string,
  apiKey: string
): Promise<'portrait' | 'landscape' | 'square'> => {
  return askBaldrickToClassify(
    `For this image: "${imagePrompt}". What aspect ratio is best?`,
    apiKey,
    ['portrait', 'landscape', 'square'] as const,
    'square'
  );
};

/**
 * Curate a list of models from raw API responses
 * Uses GPT-5 Chat via Responses API to filter down to main chat/completion models
 * Does NOT detect capabilities - that happens separately via capability testing
 */
const createBaldrickClient = (apiKey: string) =>
  new OpenAI({
    apiKey,
    timeout: 45000,
    maxRetries: 0
  });

export const curateModelList = async (
  rawModels: string[],
  provider: string,
  apiKey: string
): Promise<Array<{ model_name: string; display_name: string }>> => {
  // Provider-specific curation instructions
  const providerGuidance = provider.toLowerCase().includes('claude')
    ? `
Special rules for Claude models:
- Keep all "claude-" prefixed models that are for chat/completion
- REMOVE: Any models marked as "legacy" or "deprecated"
- Keep models like: claude-3-opus, claude-3-sonnet, claude-3-haiku, claude-3-5-sonnet, etc.
- Format display names nicely: "Claude 3.5 Sonnet", "Claude 3 Opus", etc.`
    : `
Special rules for OpenAI models:
- Keep base families: gpt-5, gpt-5-mini, gpt-5-pro, gpt-4o, gpt-4, gpt-3.5-turbo, etc.
- REMOVE: Dated versions (e.g., gpt-4-0613, gpt-5-2025-08-07)
- REMOVE: Preview/beta models (e.g., gpt-4-vision-preview)
- Do NOT treat base 'gpt-5' as preview; only remove IDs with '-preview' or date suffixes`;

  const prompt = `Given these raw ${provider.toUpperCase()} API model IDs:
${JSON.stringify(rawModels, null, 2)}

Filter and curate this list:
1. REMOVE: Fine-tuned models (e.g., ft:gpt-3.5-turbo:org-name)
2. REMOVE: Deprecated models
3. REMOVE: (THIS IS VERY IMPORTANT) - Specialty/niche models (e.g., text-embedding, whisper, tts, dall-e, search, codex, code models and so on. Anything not primarily for chat/completion.)
4. NOTE: Choose only from the provided list; do not exclude base families unless they match the removal patterns.
${providerGuidance}

For each REMAINING model, provide:
- "model_name": Exact model ID for API use (e.g., "gpt-5", "claude-3-5-sonnet-20241022")
- "display_name": Human-readable label (e.g., "GPT-5", "Claude 3.5 Sonnet")

Return ONLY a valid JSON array of objects with these two fields. No markdown, no explanation.`;

  try {
    baldrickLog(`Curating ${rawModels.length} models for provider: ${provider}`);

    const client = createBaldrickClient(apiKey);

    // Use GPT-5 Chat via Responses API
    baldrickLog('Using GPT-5 Chat via Responses API');
    const response = await client.responses.create({
      model: 'gpt-5-chat-latest',
      input: prompt,
      max_output_tokens: 3000,
      temperature: 0
    });

    // Extract text from response output
    baldrickLog('Raw response payload:', JSON.stringify(response, null, 2));

    const answer = response.output_text?.trim() || '';
    baldrickLog(`Raw curation response length: ${answer.length} chars`);
    if (answer.length < 100) {
      baldrickLog(`Raw response content: ${answer}`);
    }

    if (answer.length === 0) {
      throw new Error('Empty response from GPT-5 Chat during model curation');
    }

    // Parse JSON response
    let parsed: unknown;
    try {
      // Remove markdown code blocks if present
      const cleaned = answer.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      parsed = JSON.parse(cleaned);
    } catch (parseError) {
      baldrickLog('Failed to parse JSON response:', parseError);
      return [];
    }

    // Validate structure
    if (!Array.isArray(parsed)) {
      baldrickLog('Response is not an array');
      return [];
    }

    const validated = parsed.filter((item): item is { model_name: string; display_name: string } => {
      return (
        typeof item === 'object' &&
        item !== null &&
        typeof item.model_name === 'string' &&
        typeof item.display_name === 'string'
      );
    });

    baldrickLog(`Curated ${validated.length} models from ${rawModels.length} raw models`);

    if (validated.length === 0) {
      throw new Error('Curation returned zero models after filtering');
    }

    return validated;
  } catch (error) {
    baldrickLog('Curation failed:', error);

    // If the failure looks like a timeout/connection issue, retry once with smaller prompt & fallback model
    if (
      error instanceof Error &&
      (error.name === 'APIConnectionTimeoutError' ||
        /timed out/i.test(error.message ?? '') ||
        /Timeout/i.test(error.message ?? '') ||
        /Empty response/i.test(error.message ?? '') ||
        /zero models/i.test(error.message ?? ''))
    ) {
      baldrickLog('Retrying curation with fallback model (gpt-4.1-mini)');
      try {
        const fallbackClient = new OpenAI({ apiKey, timeout: 30000, maxRetries: 0 });
        const response = await fallbackClient.responses.create({
          model: 'gpt-4.1-mini',
          input: [
            {
              role: 'system',
              content: 'You are a precise JSON generator. Do not include explanations or reasoning; respond with JSON only.'
            },
            {
              role: 'user',
              content: prompt
            }
          ],
          max_output_tokens: 1500
        });

        const answer = response.output_text?.trim() || '';
        baldrickLog('[Fallback] Raw response payload:', JSON.stringify(response, null, 2));
        baldrickLog(`[Fallback] Raw curation response length: ${answer.length} chars`);

        const cleaned = answer.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        if (!cleaned) {
          throw new Error('[Fallback] Empty response');
        }

        const parsed = JSON.parse(cleaned) as unknown;

        if (!Array.isArray(parsed)) {
          throw new Error('[Fallback] Response is not an array');
        }

        const validated = parsed.filter((item): item is { model_name: string; display_name: string } => {
          return (
            typeof item === 'object' &&
            item !== null &&
            typeof (item as { model_name?: unknown }).model_name === 'string' &&
            typeof (item as { display_name?: unknown }).display_name === 'string'
          );
        });

        baldrickLog(`[Fallback] Curated ${validated.length} models from ${rawModels.length} raw models`);

        if (validated.length === 0) {
          throw new Error('[Fallback] Curation returned zero models');
        }
        return validated;
      } catch (fallbackError) {
        baldrickLog('[Fallback] Curation failed:', fallbackError);
        throw fallbackError instanceof Error
          ? fallbackError
          : new Error(String(fallbackError));
      }
    }

    throw error instanceof Error ? error : new Error(String(error));
  }
};
