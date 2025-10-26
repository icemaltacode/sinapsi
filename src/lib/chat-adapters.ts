import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import type { ResponseCreateParamsNonStreaming } from 'openai/resources/responses/responses';

/**
 * Common message format used internally
 * Maps to both OpenAI and Claude message structures
 */
export type ChatMessage = {
  role: 'user' | 'assistant' | 'system';
  content: string | ChatMessageContent[];
};

export type ChatMessageContent =
  | { type: 'text'; text: string }
  | { type: 'image'; imageUrl: string; detail?: 'low' | 'high' | 'auto' }
  | { type: 'document'; fileName: string; fileData: string }; // base64 PDF

/**
 * Streaming response from chat adapter
 */
export interface ChatStreamResponse {
  /**
   * Async iterator that yields text deltas
   */
  textStream: AsyncIterable<string>;

  /**
   * Final complete message (await after consuming stream)
   */
  getFinalResponse: () => Promise<ChatFinalResponse>;
}

export interface ChatFinalResponse {
  content: string;
  stopReason: string | null;
  inputTokens?: number;
  outputTokens?: number;
}

/**
 * Chat adapter interface
 * Each provider implements chat streaming and title generation
 */
export interface ChatAdapter {
  /**
   * Send a message and stream the response
   */
  sendMessage(params: {
    model: string;
    messages: ChatMessage[];
    maxTokens?: number;
  }): Promise<ChatStreamResponse>;

  /**
   * Generate a session title based on conversation history
   */
  generateTitle(params: {
    model: string;
    messages: ChatMessage[];
  }): Promise<string | undefined>;

  /**
   * Check if this provider/model supports image generation
   */
  supportsImageGeneration(model: string): boolean;
}

/**
 * OpenAI chat adapter
 * Uses OpenAI's Responses API for streaming
 */
export class OpenAIChatAdapter implements ChatAdapter {
  private client: OpenAI;

  constructor(apiKey: string) {
    this.client = new OpenAI({ apiKey });
  }

  supportsImageGeneration(model: string): boolean {
    // Models that support native image generation via Responses API
    const imageGenModels = ['gpt-5', 'gpt-5-chat-latest', 'gpt-4o'];
    return imageGenModels.some((m) => model.toLowerCase().includes(m.toLowerCase()));
  }

  async sendMessage(params: {
    model: string;
    messages: ChatMessage[];
    maxTokens?: number;
  }): Promise<ChatStreamResponse> {
    // Convert to OpenAI format
    const input = this.toOpenAIFormat(params.messages);

    const stream = this.client.responses.stream({
      model: params.model,
      input: input as unknown as ResponseCreateParamsNonStreaming['input'],
      max_output_tokens: params.maxTokens
    });

    let fullContent = '';
    let inputTokens: number | undefined;
    let outputTokens: number | undefined;
    let stopReason: string | null = null;
    let streamComplete = false;

    const textStream = async function* () {
      for await (const eventChunk of stream) {
        if (eventChunk.type === 'response.output_text.delta') {
          const delta = eventChunk.delta ?? '';
          if (delta) {
            fullContent += delta;
            yield delta;
          }
        } else if (eventChunk.type === 'response.completed') {
          const usage = eventChunk.response?.usage;
          inputTokens = usage?.input_tokens ?? inputTokens;
          outputTokens = usage?.output_tokens ?? outputTokens;
          stopReason = (eventChunk.response as { stop_reason?: string })?.stop_reason ?? null;
        }
      }
      streamComplete = true;
    };

    const getFinalResponse = async (): Promise<ChatFinalResponse> => {
      // Wait for stream to complete if not already done
      if (!streamComplete) {
        await stream.finalResponse();
      }

      return {
        content: fullContent,
        stopReason,
        inputTokens,
        outputTokens
      };
    };

    return {
      textStream: textStream(),
      getFinalResponse
    };
  }

  async generateTitle(params: {
    model: string;
    messages: ChatMessage[];
  }): Promise<string | undefined> {
    try {
      const prompt: ChatMessage[] = [
        {
          role: 'system',
          content: 'Generate a short, descriptive title (max 7 words) for the conversation. Respond with title only.'
        },
        ...params.messages
      ];

      const input = this.toOpenAIFormat(prompt);

      const response = await this.client.responses.create({
        model: params.model,
        input: input as unknown as ResponseCreateParamsNonStreaming['input']
      });

      const title = this.extractTextFromResponse(response);
      return title ? title.replace(/["']/g, '').trim() : undefined;
    } catch (error) {
      console.error('Failed to generate title with OpenAI', error);
      return undefined;
    }
  }

  private toOpenAIFormat(messages: ChatMessage[]): Array<{
    role: 'user' | 'assistant' | 'system' | 'developer';
    content: string | Array<Record<string, unknown>>;
  }> {
    return messages.map((msg) => {
      if (typeof msg.content === 'string') {
        return {
          role: msg.role as 'user' | 'assistant' | 'system' | 'developer',
          content: msg.content
        };
      }

      // Multimodal content
      const content = msg.content.map((block) => {
        if (block.type === 'text') {
          return { type: 'input_text', text: block.text };
        }
        if (block.type === 'image') {
          return { type: 'input_image', image_url: block.imageUrl, detail: block.detail || 'auto' };
        }
        if (block.type === 'document') {
          return { type: 'input_file', filename: block.fileName, file_data: block.fileData };
        }
        return { type: 'input_text', text: '' };
      });

      return {
        role: msg.role as 'user' | 'assistant' | 'system' | 'developer',
        content
      };
    });
  }

  private extractTextFromResponse(response: unknown): string {
    const candidate = response as
      | { output_text?: string[]; output?: Array<{ content?: Array<unknown> }> }
      | undefined;

    if (!candidate) {
      return '';
    }

    if (candidate.output_text && Array.isArray(candidate.output_text)) {
      return candidate.output_text.join('').trim();
    }

    if (candidate.output && Array.isArray(candidate.output)) {
      return candidate.output
        .map((block) => {
          const content = (block as { content?: Array<unknown> }).content;
          if (!Array.isArray(content)) return '';
          return content
            .map((item) => {
              if (typeof item === 'string') return item;
              if (item && typeof item === 'object') {
                if ('text' in item && typeof (item as { text?: string }).text === 'string') {
                  return (item as { text: string }).text;
                }
                if ('content' in item && typeof (item as { content?: string }).content === 'string') {
                  return (item as { content: string }).content;
                }
              }
              return '';
            })
            .join('');
        })
        .join('')
        .trim();
    }

    return '';
  }
}

/**
 * Claude chat adapter
 * Uses Anthropic's Messages API for streaming
 */
export class ClaudeChatAdapter implements ChatAdapter {
  private client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey });
  }

  supportsImageGeneration(): boolean {
    // Claude does not support image generation
    return false;
  }

  async sendMessage(params: {
    model: string;
    messages: ChatMessage[];
    maxTokens?: number;
  }): Promise<ChatStreamResponse> {
    // Convert to Claude format
    const { system, messages } = this.toClaudeFormat(params.messages);

    const stream = this.client.messages.stream({
      model: params.model,
      max_tokens: params.maxTokens || 4096,
      system: system || undefined,
      messages: messages as unknown as Anthropic.MessageParam[]
    });

    let fullContent = '';
    let inputTokens: number | undefined;
    let outputTokens: number | undefined;
    let stopReason: string | null = null;
    let streamComplete = false;

    const textStream = async function* () {
      for await (const event of stream) {
        if (event.type === 'content_block_delta') {
          if (event.delta.type === 'text_delta') {
            const delta = event.delta.text;
            if (delta) {
              fullContent += delta;
              yield delta;
            }
          }
        } else if (event.type === 'message_delta') {
          stopReason = event.delta.stop_reason;
          inputTokens = event.usage.input_tokens || inputTokens;
          outputTokens = event.usage.output_tokens || outputTokens;
        }
      }
      streamComplete = true;
    };

    const getFinalResponse = async (): Promise<ChatFinalResponse> => {
      // Wait for stream to complete if not already done
      if (!streamComplete) {
        await stream.finalMessage();
      }

      return {
        content: fullContent,
        stopReason,
        inputTokens,
        outputTokens
      };
    };

    return {
      textStream: textStream(),
      getFinalResponse
    };
  }

  async generateTitle(params: {
    model: string;
    messages: ChatMessage[];
  }): Promise<string | undefined> {
    try {
      const { messages } = this.toClaudeFormat([
        {
          role: 'user',
          content: 'Generate a short, descriptive title (max 7 words) for the following conversation. Respond with title only.'
        },
        ...params.messages
      ]);

      const response = await this.client.messages.create({
        model: params.model,
        max_tokens: 100,
        messages: messages as unknown as Anthropic.MessageParam[]
      });

      const text = response.content
        .filter((block) => block.type === 'text')
        .map((block) => (block as { text: string }).text)
        .join('')
        .trim();

      return text ? text.replace(/["']/g, '').trim() : undefined;
    } catch (error) {
      console.error('Failed to generate title with Claude', error);
      return undefined;
    }
  }

  private toClaudeFormat(messages: ChatMessage[]): {
    system: string | null;
    messages: Array<{
      role: 'user' | 'assistant';
      content: string | Array<Record<string, unknown>>;
    }>;
  } {
    // Claude requires system messages to be separate
    let system: string | null = null;
    const claudeMessages: Array<{
      role: 'user' | 'assistant';
      content: string | Array<{ type: string; text?: string; source?: unknown }>;
    }> = [];

    for (const msg of messages) {
      if (msg.role === 'system') {
        // Combine multiple system messages
        const text = typeof msg.content === 'string' ? msg.content : this.extractTextFromContent(msg.content);
        system = system ? `${system}\n\n${text}` : text;
        continue;
      }

      if (typeof msg.content === 'string') {
        claudeMessages.push({
          role: msg.role === 'assistant' ? 'assistant' : 'user',
          content: msg.content
        });
      } else {
        // Multimodal content
        const content = msg.content.map((block) => {
          if (block.type === 'text') {
            return { type: 'text', text: block.text };
          }
          if (block.type === 'image') {
            // Extract base64 data from data URL
            const base64Match = block.imageUrl.match(/^data:image\/(png|jpeg|gif|webp);base64,(.+)$/);
            if (base64Match) {
              return {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: `image/${base64Match[1]}` as 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp',
                  data: base64Match[2]
                }
              };
            }
            // Otherwise treat as URL
            return {
              type: 'image',
              source: {
                type: 'url',
                url: block.imageUrl
              }
            };
          }
          if (block.type === 'document') {
            // Extract base64 PDF data
            const pdfMatch = block.fileData.match(/^data:application\/pdf;base64,(.+)$/);
            if (pdfMatch) {
              return {
                type: 'document',
                source: {
                  type: 'base64',
                  media_type: 'application/pdf',
                  data: pdfMatch[1]
                }
              };
            }
          }
          return { type: 'text', text: '' };
        });

        claudeMessages.push({
          role: msg.role === 'assistant' ? 'assistant' : 'user',
          content
        });
      }
    }

    return { system, messages: claudeMessages };
  }

  private extractTextFromContent(content: ChatMessageContent[]): string {
    return content
      .filter((block): block is { type: 'text'; text: string } => block.type === 'text')
      .map((block) => block.text)
      .join('\n');
  }
}

/**
 * Get the appropriate chat adapter based on provider type
 */
export function getChatAdapter(providerType: string, apiKey: string): ChatAdapter {
  const normalized = providerType.toLowerCase();

  switch (normalized) {
    case 'openai':
      return new OpenAIChatAdapter(apiKey);
    case 'claude':
      return new ClaudeChatAdapter(apiKey);
    default:
      console.warn(`[ChatAdapter] Unknown provider type: ${providerType}, defaulting to OpenAI adapter`);
      return new OpenAIChatAdapter(apiKey);
  }
}
