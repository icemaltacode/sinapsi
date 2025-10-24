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
 * Uses GPT-5 via Responses API to filter down to main chat/completion models
 * Does NOT detect capabilities - that happens separately via capability testing
 */
export const curateModelList = async (
  rawModels: string[],
  provider: string,
  apiKey: string
): Promise<Array<{ model_name: string; display_name: string }>> => {
  try {
    baldrickLog(`Curating ${rawModels.length} models for provider: ${provider}`);

    const prompt = `Given these raw ${provider.toUpperCase()} API model IDs:
${JSON.stringify(rawModels, null, 2)}

Filter and curate this list:
1. REMOVE: Dated/snapshot versions (e.g., gpt-4-0613, gpt-5-2025-08-07)
2. REMOVE: Fine-tuned models (e.g., ft:gpt-3.5-turbo:org-name)
3. REMOVE: Preview/beta models (e.g., gpt-4-vision-preview). Do NOT treat base 'gpt-5' as preview; only remove IDs that contain '-preview' or date suffixes.
4. REMOVE: Deprecated models
5. REMOVE: Specialty/niche models (e.g., text-embedding, whisper, tts, dall-e)
6. NOTE: If present, always include: gpt-5, gpt-5-mini, gpt-5-pro
7. NOTE: Choose only from the provided list; do not exclude base families unless they match the removal patterns.

For each REMAINING model, provide:
- "model_name": Exact model ID for API use (e.g., "gpt-5", "gpt-4o")
- "display_name": Human-readable label (e.g., "GPT-5", "GPT-4o")

Return ONLY a valid JSON array of objects with these two fields. No markdown, no explanation.`;

    const client = new OpenAI({ apiKey, timeout: 90000 }); // 90s timeout for GPT-5 Responses API

    // Use GPT-5 via Responses API
    baldrickLog('Using GPT-5 via Responses API');
    const response = await client.responses.create({
      model: 'gpt-5',
      input: prompt
    });

    // Extract text from response output
    const answer = response.output_text?.trim() || '';
    baldrickLog(`Raw curation response length: ${answer.length} chars`);
    if (answer.length < 100) {
      baldrickLog(`Raw response content: ${answer}`);
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

    return validated;
  } catch (error) {
    baldrickLog('Curation failed:', error);
    return [];
  }
};
