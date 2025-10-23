import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import OpenAI from 'openai';

import { getModelCache, saveModelCapabilities, type ModelData } from '../repositories/model-cache';

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
    await client.responses.create({
      model,
      input: 'Generate a simple image of a red circle on a white background.',
      tools: [{ type: 'image_generation' }]
    });
    return true;
  } catch (error) {
    // Typical error for unsupported models: "Unsupported tool type: image_generation"
    console.log(`[Capabilities] Image gen test failed for ${model}:`, error instanceof Error ? error.message : String(error));
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
      input: 'Hello from the capability checker.',
      format: 'wav'
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
      file: fileStream as any
    });
    return true;
  } catch (error) {
    console.log(`[Capabilities] Transcription test failed for ${model}:`, error instanceof Error ? error.message : String(error));
    return false;
  } finally {
    fs.existsSync(wavPath) && fs.unlinkSync(wavPath);
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

    const client = new OpenAI({ apiKey, timeout: 30000 });

    // Test each model's capabilities in parallel
    const updatedModels: ModelData[] = await Promise.all(
      cache.models.map(async (model) => {
        console.log(`[Capabilities] Testing ${model.id}...`);

        // Test all three capabilities in parallel for this model
        const [img, tts, asr] = await Promise.all([
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
          })
        ]);

        console.log(`[Capabilities] ${model.id}: img=${img}, tts=${tts}, asr=${asr}`);

        return {
          ...model,
          supportsImageGeneration: img,
          supportsTTS: tts,
          supportsTranscription: asr
        };
      })
    );

    // Save updated capabilities to DynamoDB with capabilitiesRefreshed timestamp
    await saveModelCapabilities(providerId, updatedModels);

    console.log(`[Capabilities] Updated ${updatedModels.length} models for ${providerId}`);
  } catch (error) {
    console.error(`[Capabilities] Error testing capabilities for ${providerId}:`, error);
    throw error;
  }
}
