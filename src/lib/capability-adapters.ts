import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';

/**
 * Capability test results for a model
 */
export interface CapabilityTestResult {
  supportsImageGeneration: boolean | null;
  supportsTTS: boolean | null;
  supportsTranscription: boolean | null;
  supportsFileUpload: boolean | null;
}

/**
 * Capability testing adapter interface
 * Each provider implements its own capability detection logic
 */
export interface CapabilityAdapter {
  /**
   * Test all capabilities for a given model
   */
  testCapabilities(modelId: string, apiKey: string): Promise<CapabilityTestResult>;

  /**
   * Get the provider type identifier
   */
  getProviderType(): string;
}

/**
 * OpenAI capability adapter
 * Tests image generation, TTS, transcription, and file upload capabilities
 */
class OpenAICapabilityAdapter implements CapabilityAdapter {
  getProviderType(): string {
    return 'openai';
  }

  async testCapabilities(modelId: string, apiKey: string): Promise<CapabilityTestResult> {
    const client = new OpenAI({ apiKey, timeout: 600000 });

    console.log(`[OpenAI Capability] Testing capabilities for ${modelId}`);

    const [imageGen, tts, transcription, fileUpload] = await Promise.all([
      this.testImageGeneration(client, modelId),
      this.testTTS(client, modelId),
      this.testTranscription(client, modelId),
      this.testFileUpload(client, modelId)
    ]);

    console.log(
      `[OpenAI Capability] ${modelId}: img=${imageGen}, tts=${tts}, asr=${transcription}, files=${fileUpload}`
    );

    return {
      supportsImageGeneration: imageGen,
      supportsTTS: tts,
      supportsTranscription: transcription,
      supportsFileUpload: fileUpload
    };
  }

  private async testImageGeneration(client: OpenAI, model: string): Promise<boolean | null> {
    try {
      const requestClient = client.withOptions({ timeout: 60000 });

      await requestClient.responses.create({
        model,
        input: 'Generate a simple image of a red circle on a white background.',
        tools: [{ type: 'image_generation' }]
      });
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      if (message.toLowerCase().includes('timed out')) {
        console.log(`[OpenAI Capability] Image gen test timed out for ${model}:`, message);
        return null;
      }

      return false;
    }
  }

  private async testTTS(client: OpenAI, model: string): Promise<boolean | null> {
    try {
      const res = await client.audio.speech.create({
        model,
        voice: 'alloy',
        input: 'Hello from the capability checker.'
      });
      await res.arrayBuffer();
      return true;
    } catch {
      return false;
    }
  }

  private async testTranscription(client: OpenAI, model: string): Promise<boolean | null> {
    const fs = await import('node:fs');
    const os = await import('node:os');
    const path = await import('node:path');

    // Create tiny WAV file
    const wavPath = this.createSilenceWav(fs, os, path);

    try {
      const fileStream = fs.createReadStream(wavPath);
      await client.audio.transcriptions.create({
        model,
        file: fileStream
      });
      return true;
    } catch {
      return false;
    } finally {
      if (fs.existsSync(wavPath)) {
        fs.unlinkSync(wavPath);
      }
    }
  }

  private async testFileUpload(client: OpenAI, model: string): Promise<boolean | null> {
    const tiny1x1RedPng =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==';

    const getErrorMessage = (error: unknown): string => {
      if (error instanceof Error) return error.message;
      if (
        error &&
        typeof error === 'object' &&
        'message' in error &&
        typeof (error as { message: unknown }).message === 'string'
      ) {
        return (error as { message: string }).message;
      }
      return String(error);
    };

    const shouldRetryWithResponses = (error: unknown): boolean => {
      const message = getErrorMessage(error).toLowerCase();
      return (
        message.includes('only supported in v1/responses') ||
        message.includes('not supported in v1/chat/completions') ||
        message.includes("use 'max_completion_tokens'")
      );
    };

    try {
      await client.chat.completions.create({
        model,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'What color is this pixel?' },
              {
                type: 'image_url',
                image_url: { url: `data:image/png;base64,${tiny1x1RedPng}` }
              }
            ]
          }
        ],
        max_tokens: 10
      });
      return true;
    } catch (error) {
      if (!shouldRetryWithResponses(error)) {
        return false;
      }

      try {
        await client.responses.create({
          model,
          input: [
            {
              role: 'user',
              content: [
                { type: 'input_text', text: 'What color is this pixel?' },
                {
                  type: 'input_image',
                  image_url: `data:image/png;base64,${tiny1x1RedPng}`,
                  detail: 'low'
                }
              ]
            }
          ],
          max_output_tokens: 64
        });
        return true;
      } catch {
        return false;
      }
    }
  }

  private createSilenceWav(
    fs: typeof import('node:fs'),
    os: typeof import('node:os'),
    path: typeof import('node:path')
  ): string {
    const sampleRate = 16000;
    const durationSec = 0.2;
    const numSamples = Math.floor(sampleRate * durationSec);
    const bytesPerSample = 2;
    const dataSize = numSamples * bytesPerSample;
    const headerSize = 44;
    const buffer = Buffer.alloc(headerSize + dataSize);

    // RIFF header
    buffer.write('RIFF', 0);
    buffer.writeUInt32LE(36 + dataSize, 4);
    buffer.write('WAVE', 8);
    // fmt chunk
    buffer.write('fmt ', 12);
    buffer.writeUInt32LE(16, 16);
    buffer.writeUInt16LE(1, 20);
    buffer.writeUInt16LE(1, 22);
    buffer.writeUInt32LE(sampleRate, 24);
    buffer.writeUInt32LE(sampleRate * bytesPerSample, 28);
    buffer.writeUInt16LE(bytesPerSample, 32);
    buffer.writeUInt16LE(16, 34);
    // data chunk
    buffer.write('data', 36);
    buffer.writeUInt32LE(dataSize, 40);

    const tmp = path.join(os.tmpdir(), `silence_${Date.now()}.wav`);
    fs.writeFileSync(tmp, buffer);
    return tmp;
  }
}

/**
 * Claude capability adapter
 * Claude models support vision/file upload, but not image generation, TTS, or transcription
 */
class ClaudeCapabilityAdapter implements CapabilityAdapter {
  getProviderType(): string {
    return 'claude';
  }

  async testCapabilities(modelId: string, apiKey: string): Promise<CapabilityTestResult> {
    console.log(`[Claude Capability] Testing capabilities for ${modelId}`);

    // Test vision/file upload capability
    const fileUpload = await this.testVision(modelId, apiKey);

    // Claude doesn't support these capabilities
    const result = {
      supportsImageGeneration: false,
      supportsTTS: false,
      supportsTranscription: false,
      supportsFileUpload: fileUpload
    };

    console.log(
      `[Claude Capability] ${modelId}: img=false, tts=false, asr=false, files=${fileUpload}`
    );

    return result;
  }

  private async testVision(modelId: string, apiKey: string): Promise<boolean | null> {
    try {
      const client = new Anthropic({ apiKey, timeout: 30000 });

      // Test with a tiny 1x1 red PNG
      const tiny1x1RedPng =
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==';

      await client.messages.create({
        model: modelId,
        max_tokens: 10,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: 'image/png',
                  data: tiny1x1RedPng
                }
              },
              {
                type: 'text',
                text: 'What color is this?'
              }
            ]
          }
        ]
      });

      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.log(`[Claude Capability] Vision test failed for ${modelId}:`, message);

      // If it's a model-not-found or similar error, return null (unknown)
      if (message.toLowerCase().includes('not found') || message.toLowerCase().includes('invalid')) {
        return null;
      }

      return false;
    }
  }
}

/**
 * Get the appropriate capability adapter based on provider type
 */
export function getCapabilityAdapter(providerType: string): CapabilityAdapter {
  const normalized = providerType.toLowerCase();

  switch (normalized) {
    case 'openai':
      return new OpenAICapabilityAdapter();
    case 'claude':
      return new ClaudeCapabilityAdapter();
    default:
      // Default to OpenAI for unknown providers (backward compatibility)
      console.warn(
        `[CapabilityAdapter] Unknown provider type: ${providerType}, defaulting to OpenAI adapter`
      );
      return new OpenAICapabilityAdapter();
  }
}
