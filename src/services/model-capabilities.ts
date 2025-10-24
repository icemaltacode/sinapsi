import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import OpenAI from 'openai';

import {
  getModelCache,
  saveModelCapabilities,
  updateModelCapabilityEntry,
  type ModelData
} from '../repositories/model-cache';

import { getProviderApiKey } from './provider-secrets';

/** --- Helpers ------------------------------------------------------------ **/

/**
 * Create a tiny 0.2s mono WAV of silence at 16kHz and return a temp file path
 * Used for testing transcription capabilities
 */
function writeTinySilenceWav(): string {
  const sampleRate = 16000;
  const durationSec = 0.2;
  const numSamples = Math.floor(sampleRate * durationSec);
  const bytesPerSample = 2; // 16-bit PCM
  const dataSize = numSamples * bytesPerSample;
  const headerSize = 44;
  const buffer = Buffer.alloc(headerSize + dataSize);

  // RIFF header
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4); // file size - 8
  buffer.write('WAVE', 8);
  // fmt chunk
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16); // PCM header size
  buffer.writeUInt16LE(1, 20); // PCM format
  buffer.writeUInt16LE(1, 22); // channels = 1 (mono)
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * bytesPerSample, 28); // byte rate
  buffer.writeUInt16LE(bytesPerSample, 32); // block align
  buffer.writeUInt16LE(16, 34); // bits per sample
  // data chunk
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);
  // samples already zeroed (silence)

  const tmp = path.join(os.tmpdir(), `silence_${Date.now()}.wav`);
  fs.writeFileSync(tmp, buffer);
  return tmp;
}

/**
 * Test if a model supports native image generation via Responses API
 */
async function supportsImageGeneration(client: OpenAI, model: string): Promise<boolean | null> {
  try {
    const requestClient = client.withOptions({ timeout: 60000 });

    await requestClient.responses.create({
      model,
      input: 'Generate a simple image of a red circle on a white background.',
      tools: [{ type: 'image_generation' }]
    });
    return true;
  } catch (error) {
    // Typical error for unsupported models: "Unsupported tool type: image_generation"
    const message = error instanceof Error ? error.message : String(error);

    if (message.toLowerCase().includes('timed out')) {
      console.log(`[Capabilities] Image gen test timed out for ${model}:`, message);
      return null;
    }

    console.log(`[Capabilities] Image gen test failed for ${model}:`, message);
    return false;
  }
}

/**
 * Test if a model supports text-to-speech
 */
async function supportsTTS(client: OpenAI, model: string): Promise<boolean | null> {
  try {
    const res = await client.audio.speech.create({
      model, // e.g., "gpt-4o-mini-tts" supports TTS; most chat models do not
      voice: 'alloy',
      input: 'Hello from the capability checker.'
    });
    // Accessing the bytes forces the API call to complete
    await res.arrayBuffer();
    return true;
  } catch (error) {
    console.log(`[Capabilities] TTS test failed for ${model}:`, error instanceof Error ? error.message : String(error));
    return false;
  }
}

/**
 * Test if a model supports transcription
 */
async function supportsTranscription(client: OpenAI, model: string): Promise<boolean | null> {
  const wavPath = writeTinySilenceWav();
  try {
    const fileStream = fs.createReadStream(wavPath);
    await client.audio.transcriptions.create({
      model, // typically "whisper-1" supports this; most chat models do not
      file: fileStream
    });
    return true;
  } catch (error) {
    console.log(`[Capabilities] Transcription test failed for ${model}:`, error instanceof Error ? error.message : String(error));
    return false;
  } finally {
    if (fs.existsSync(wavPath)) {
      fs.unlinkSync(wavPath);
    }
  }
}

/**
 * Test if a model supports file uploads (vision/multimodal)
 */
async function supportsFileUpload(client: OpenAI, model: string): Promise<boolean | null> {
  const getErrorMessage = (error: unknown): string => {
    if (error instanceof Error) {
      return error.message;
    }
    if (error && typeof error === 'object' && 'message' in error && typeof (error as { message: unknown }).message === 'string') {
      return (error as { message: string }).message;
    }
    return String(error);
  };

  const shouldRetryWithResponses = (error: unknown): boolean => {
    const message = getErrorMessage(error).toLowerCase();
    return (
      message.includes('only supported in v1/responses') ||
      message.includes('not supported in v1/chat/completions') ||
      message.includes('use \'max_completion_tokens\'')
    );
  };

  const tiny1x1RedPng = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==';

  try {
    await client.chat.completions.create({
      model,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: 'What color is this pixel?'
            },
            {
              type: 'image_url',
              image_url: {
                url: `data:image/png;base64,${tiny1x1RedPng}`
              }
            }
          ]
        }
      ],
      max_tokens: 10
    });
    return true;
  } catch (error) {
    if (!shouldRetryWithResponses(error)) {
      console.log(`[Capabilities] File upload test failed for ${model}:`, getErrorMessage(error));
      return false;
    }

    try {
      const maxOutputTokens = 64;

      await client.responses.create({
        model,
        input: [
          {
            role: 'user',
            content: [
              {
                type: 'input_text',
                text: 'What color is this pixel?'
              },
              {
                type: 'input_image',
                image_url: `data:image/png;base64,${tiny1x1RedPng}`,
                detail: 'low'
              }
            ]
          }
        ],
        max_output_tokens: maxOutputTokens
      });

      return true;
    } catch (responsesError) {
      console.log(`[Capabilities] File upload test failed for ${model}:`, getErrorMessage(responsesError));
      return false;
    }
  }
}

/** --- Main ------------------------------------------------------------ **/

/**
 * Test model capabilities for a specific provider
 * Updates DynamoDB with the results
 */
export async function testModelCapabilities(providerId: string): Promise<void> {
  console.log(`[Capabilities] Starting capability testing for provider: ${providerId}`);

  try {
    // Get API key from Secrets Manager
    const apiKey = await getProviderApiKey(providerId);

    // Get current model cache
    const cache = await getModelCache(providerId);
    if (!cache || !cache.models.length) {
      console.log(`[Capabilities] No models found in cache for ${providerId}`);
      return;
    }

    console.log(`[Capabilities] Testing capabilities for ${cache.models.length} models`);

    const client = new OpenAI({ apiKey, timeout: 600000 });
    const updatedModels: ModelData[] = [];

    for (const model of cache.models) {
      console.log(`[Capabilities] Testing ${model.id}...`);

      const [img, tts, asr, files] = await Promise.all([
        supportsImageGeneration(client, model.id).catch((err) => {
          console.error(`[Capabilities] Image gen error for ${model.id}:`, err);
          return null;
        }),
        supportsTTS(client, model.id).catch((err) => {
          console.error(`[Capabilities] TTS error for ${model.id}:`, err);
          return null;
        }),
        supportsTranscription(client, model.id).catch((err) => {
          console.error(`[Capabilities] Transcription error for ${model.id}:`, err);
          return null;
        }),
        supportsFileUpload(client, model.id).catch((err) => {
          console.error(`[Capabilities] File upload error for ${model.id}:`, err);
          return null;
        })
      ]);

      console.log(`[Capabilities] ${model.id}: img=${img}, tts=${tts}, asr=${asr}, files=${files}`);

      const updatedModel: ModelData = {
        ...model,
        supportsImageGeneration: img,
        supportsTTS: tts,
        supportsTranscription: asr,
        supportsFileUpload: files
      };

      updatedModels.push(updatedModel);

      try {
        await updateModelCapabilityEntry(providerId, updatedModel);
        console.log(
          `[Capabilities] Persisted capability update for ${model.id}: img=${img}, tts=${tts}, asr=${asr}, files=${files}`
        );
      } catch (updateError) {
        console.error(`[Capabilities] Failed to persist capability update for ${model.id}:`, updateError);
      }
    }

    await saveModelCapabilities(providerId, updatedModels);

    console.log(`[Capabilities] Updated ${updatedModels.length} models for ${providerId}`);
  } catch (error) {
    console.error(`[Capabilities] Error testing capabilities for ${providerId}:`, error);
    throw error;
  }
}
