import type { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import OpenAI from 'openai';

import { badRequest, ok, serverError } from '../lib/response';
import { getProviderApiKey } from '../services/provider-secrets';

type ChatMessageRole = 'system' | 'user' | 'assistant';

interface ChatMessage {
  role: ChatMessageRole;
  content: string;
}

interface ChatRequestPayload {
  provider: string;
  model: string;
  messages: ChatMessage[];
  stream?: boolean;
}

const parsePayload = (body: string): ChatRequestPayload => JSON.parse(body);

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  try {
    if (!event.body) {
      return badRequest('Request body is required');
    }

    const payload = parsePayload(event.body);

    if (!payload.provider || !payload.model || !payload.messages?.length) {
      return badRequest('provider, model and at least one message are required');
    }

    if (payload.stream) {
      return badRequest('Streaming responses are not supported yet');
    }

    if (payload.provider !== 'openai') {
      return badRequest(`Provider ${payload.provider} not supported yet`);
    }

    const apiKey = await getProviderApiKey('openai');
    const client = new OpenAI({ apiKey });

    const response = await client.chat.completions.create({
      model: payload.model,
      stream: false,
      messages: payload.messages.map((message) => ({
        role: message.role,
        content: message.content
      }))
    });

    const choice = response.choices[0];
    const content = choice?.message?.content ?? '';

    return ok({
      provider: payload.provider,
      model: payload.model,
      response: content,
      usage: response.usage,
      id: response.id
    });
  } catch (error) {
    console.error('chat.handler error', error);
    return serverError(error);
  }
};
