import { randomUUID } from 'node:crypto';

import {
  ApiGatewayManagementApiClient,
  PostToConnectionCommand
} from '@aws-sdk/client-apigatewaymanagementapi';
import type { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import OpenAI from 'openai';

import { getUserId } from '../lib/auth';
import type { SessionEventItem, SessionSummaryItem } from '../lib/dynamo';
import { badRequest, ok, serverError } from '../lib/response';
import {
  createSession,
  deleteSession as removeSession,
  getSession,
  listMessages,
  listSessions,
  saveMessage,
  updateSessionMetadata
} from '../repositories/chat-sessions';
import { getProviderConfig, listProviderConfigs } from '../repositories/providers';
import { deleteConnection as removeConnection, getConnection } from '../repositories/websocket-connections';
import { getProviderApiKey } from '../services/provider-secrets';

type ProviderModel = {
  id: string;
  label: string;
};

type ProviderEntry = {
  providerId: string;
  providerType: string;
  instanceName: string;
  models: ProviderModel[];
};

type ResponseMessageInput = {
  role: 'user' | 'assistant' | 'system';
  content: string;
};

const WEBSOCKET_MANAGEMENT_URL = process.env.WEBSOCKET_MANAGEMENT_URL;

if (!WEBSOCKET_MANAGEMENT_URL) {
  throw new Error('WEBSOCKET_MANAGEMENT_URL is not configured');
}

const wsClient = new ApiGatewayManagementApiClient({
  endpoint: WEBSOCKET_MANAGEMENT_URL
});

const modelCache = new Map<string, { expiresAt: number; models: ProviderModel[] }>();
const MODEL_CACHE_TTL_MS = 5 * 60 * 1000;

const guessProviderType = (providerId: string, providerType?: string): string => {
  if (providerType) {
    return providerType;
  }

  const id = providerId.toLowerCase();
  if (id.includes('openai') || id.includes('gpt')) {
    return 'gpt';
  }
  if (id.includes('claude')) {
    return 'claude';
  }
  if (id.includes('gemini')) {
    return 'gemini';
  }
  if (id.includes('copilot')) {
    return 'copilot';
  }

  return 'gpt';
};

const formatModelLabel = (modelId: string) =>
  modelId
    .replace(/-/g, ' ')
    .replace(/\b([a-z])/g, (match) => match.toUpperCase())
    .replace(/\bgpt\b/i, 'GPT');

const isRelevantChatModel = (modelId: string): boolean => {
  // Exclude fine-tuned models (contain ':')
  if (modelId.includes(':')) {
    return false;
  }

  // Exclude non-chat models
  if (
    modelId.includes('whisper') ||
    modelId.includes('tts') ||
    modelId.includes('dall-e') ||
    modelId.includes('embedding') ||
    modelId.includes('babbage') ||
    modelId.includes('davinci') ||
    modelId.includes('curie') ||
    modelId.includes('ada') ||
    modelId.includes('text-moderation')
  ) {
    return false;
  }

  // Exclude instruct variants
  if (modelId.includes('instruct')) {
    return false;
  }

  // Exclude vision-only models (but allow vision-capable chat models)
  if (modelId.endsWith('-vision') || modelId.includes('vision-preview')) {
    return false;
  }

  // Exclude specialty models
  if (
    modelId.includes('search-api') ||
    modelId.includes('codex') ||
    modelId.includes('realtime')
  ) {
    return false;
  }

  // Exclude preview/snapshot versions (keep only "latest" or base model names)
  // Exclude models with dates like gpt-5-2025-08-07 or old snapshot IDs like gpt-4-0613
  if (
    /-\d{4}-\d{2}-\d{2}$/.test(modelId) || // Dated versions like gpt-5-2025-08-07
    /-\d{4}$/.test(modelId) || // Old snapshots like gpt-4-0613
    modelId.includes('-preview')
  ) {
    return false;
  }

  // Exclude nano variants (too small for general use)
  if (modelId.includes('-nano')) {
    return false;
  }

  // Exclude 16k variants (redundant, base model already supports it)
  if (modelId.endsWith('-16k')) {
    return false;
  }

  // Include any GPT-N family (gpt-3.5, gpt-4, gpt-5, etc.)
  // Matches: gpt-4, gpt-4o, gpt-4-turbo, gpt-5, gpt-5-mini, gpt-5-pro, etc.
  const gptPattern = /^gpt-\d+(\.\d+)?(-[a-z]+)?$/;

  // Include any o-series models (o1, o2, o3, o100, etc.)
  // Matches: o1, o1-mini, o1-pro, o3, o3-mini, etc.
  const oSeriesPattern = /^o\d+(-[a-z]+)?$/;

  return gptPattern.test(modelId) || oSeriesPattern.test(modelId);
};

const fetchOpenAIModels = async (apiKey: string): Promise<ProviderModel[]> => {
  try {
    const client = new OpenAI({ apiKey });
    const models = await client.models.list();
    const filtered = models.data
      .map((model) => model.id)
      .filter(isRelevantChatModel);

    const unique = Array.from(new Set(filtered));
    unique.sort((a, b) => {
      // Sort with newer models first, o-series at top
      if (a.startsWith('o') && !b.startsWith('o')) return -1;
      if (!a.startsWith('o') && b.startsWith('o')) return 1;
      return b.localeCompare(a); // Reverse alphabetical for GPT models (4o before 4)
    });

    return unique.map((id) => ({
      id,
      label: formatModelLabel(id)
    }));
  } catch (error) {
    console.error('Failed to fetch OpenAI models', error);
    // Fallback list
    return [
      { id: 'gpt-4o', label: 'GPT-4o' },
      { id: 'gpt-4o-mini', label: 'GPT-4o Mini' },
      { id: 'gpt-3.5-turbo', label: 'GPT-3.5 Turbo' }
    ];
  }
};

const listModelsForProvider = async (
  providerId: string,
  providerType: string
): Promise<ProviderModel[]> => {
  const cacheKey = `${providerType}:${providerId}`;
  const cached = modelCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.models;
  }

  let models: ProviderModel[] = [];

  if (providerType === 'gpt') {
    const apiKey = await getProviderApiKey(providerId);
    models = await fetchOpenAIModels(apiKey);
  }

  modelCache.set(cacheKey, { models, expiresAt: Date.now() + MODEL_CACHE_TTL_MS });
  return models;
};

const sendToConnection = async (connectionId: string, payload: unknown) => {
  try {
    await wsClient.send(
      new PostToConnectionCommand({
        ConnectionId: connectionId,
        Data: Buffer.from(JSON.stringify(payload))
      })
    );
  } catch (error) {
    if ((error as { name?: string }).name === 'GoneException') {
      console.warn(`Connection ${connectionId} is gone, cleaning up`);
      await removeConnection(connectionId);
    } else {
      console.error('Failed to send WebSocket message', error);
      throw error;
    }
  }
};

const mapEventsToInput = (events: SessionEventItem[]): ResponseMessageInput[] =>
  events
    .filter((event) => event.eventType === 'message')
    .map((event) => ({
      role: event.role,
      content: event.content
    }));

const toSessionSummaryResponse = (session: SessionSummaryItem) => ({
  sessionId: session.sessionId,
  ownerUserId: session.ownerUserId,
  providerId: session.providerId,
  providerType: session.providerType,
  providerInstanceName: session.providerInstanceName,
  model: session.model,
  title: session.title ?? null,
  lastInteractionAt: session.lastInteractionAt,
  pinned: session.pinned,
  status: session.status,
  liveConnectionId: session.liveConnectionId ?? null
});

const toChatMessageResponse = (message: SessionEventItem) => ({
  messageId: message.messageId,
  role: message.role,
  content: message.content,
  createdAt: message.createdAt,
  provider: message.provider,
  createdBy: message.createdBy,
  tokensIn: message.tokensIn,
  tokensOut: message.tokensOut
});

const extractTextFromResponse = (response: unknown) => {
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
};

export const providers: APIGatewayProxyHandlerV2 = async (_event) => {
  void _event;
  try {
    const configs = await listProviderConfigs();
    const active = configs.filter((config) => config.status !== 'revoked');

    const items: ProviderEntry[] = [];
    for (const config of active) {
      const providerType = guessProviderType(config.provider, config.providerType);
      const instanceName = config.instanceName ?? config.label ?? config.provider;

      let models: ProviderModel[] = [];
      try {
        models = await listModelsForProvider(config.provider, providerType);
      } catch (error) {
        console.error(`Failed to list models for provider ${config.provider}`, error);
      }

      items.push({
        providerId: config.provider,
        providerType,
        instanceName,
        models
      });
    }

    return ok({ items });
  } catch (error) {
    console.error('chat.providers error', error);
    return serverError(error);
  }
};

export const sessionsCreate: APIGatewayProxyHandlerV2 = async (event) => {
  try {
    if (!event.body) {
      return badRequest('Request body is required');
    }

    const userId = getUserId(event.requestContext);
    const payload = JSON.parse(event.body) as {
      providerId?: string;
      model?: string;
      connectionId?: string;
    };

    if (!payload.providerId || !payload.model) {
      return badRequest('providerId and model are required');
    }

    const config = await getProviderConfig(payload.providerId);
    if (!config) {
      return badRequest(`Provider ${payload.providerId} not found`);
    }

    const providerType = guessProviderType(config.provider, config.providerType);
    const sessionId = randomUUID();

    if (payload.connectionId) {
      const connection = await getConnection(payload.connectionId);
      if (!connection || connection.userId !== userId) {
        return badRequest('Connection is not registered for this user');
      }
    }

    const sessionRecord = await createSession({
      sessionId,
      userId,
      providerId: config.provider,
      providerType,
      providerInstanceName: config.instanceName ?? config.label ?? config.provider,
      model: payload.model,
      connectionId: payload.connectionId
    });

    return ok({ session: toSessionSummaryResponse(sessionRecord) });
  } catch (error) {
    console.error('chat.sessionsCreate error', error);
    return serverError(error);
  }
};

export const sessionsList: APIGatewayProxyHandlerV2 = async (event) => {
  try {
    const userId = getUserId(event.requestContext);
    const limitParam = event.queryStringParameters?.limit;
    const cursor = event.queryStringParameters?.cursor;

    const limit =
      limitParam && !Number.isNaN(Number(limitParam)) ? Number.parseInt(limitParam, 10) : undefined;

    const result = await listSessions({ userId, limit, cursor });
    result.items.sort((a, b) => b.lastInteractionAt.localeCompare(a.lastInteractionAt));

    return ok({
      items: result.items.map(toSessionSummaryResponse),
      nextCursor: result.nextCursor
    });
  } catch (error) {
    console.error('chat.sessionsList error', error);
    return serverError(error);
  }
};

export const sessionsGet: APIGatewayProxyHandlerV2 = async (event) => {
  try {
    const sessionId = event.pathParameters?.sessionId;
    if (!sessionId) {
      return badRequest('sessionId is required');
    }

    const userId = getUserId(event.requestContext);
    const session = await getSession(userId, sessionId);

    if (!session) {
      return badRequest('Session not found');
    }

    const messages = await listMessages(sessionId);

    return ok({
      session: toSessionSummaryResponse(session),
      messages: messages.map(toChatMessageResponse)
    });
  } catch (error) {
    console.error('chat.sessionsGet error', error);
    return serverError(error);
  }
};

export const sessionsUpdate: APIGatewayProxyHandlerV2 = async (event) => {
  try {
    const sessionId = event.pathParameters?.sessionId;
    if (!sessionId) {
      return badRequest('sessionId is required');
    }

    if (!event.body) {
      return badRequest('Request body is required');
    }

    const payload = JSON.parse(event.body) as {
      pinned?: boolean;
      title?: string;
      connectionId?: string | null;
    };

    const userId = getUserId(event.requestContext);
    const session = await getSession(userId, sessionId);

    if (!session) {
      return badRequest('Session not found');
    }

    const updates: Parameters<typeof updateSessionMetadata>[1] = {};

    if (typeof payload.pinned === 'boolean') {
      updates.pinned = payload.pinned;
    }

    if (typeof payload.title === 'string') {
      updates.title = payload.title.trim() || undefined;
    }

    if (payload.connectionId !== undefined) {
      if (payload.connectionId === null) {
        updates.liveConnectionId = undefined;
      } else {
        const connection = await getConnection(payload.connectionId);
        if (!connection || connection.userId !== userId) {
          return badRequest('Connection is not registered for this user');
        }
        updates.liveConnectionId = payload.connectionId;
      }
    }

    if (Object.keys(updates).length === 0) {
      return ok({ session });
    }

    const updated = await updateSessionMetadata(session, updates);
    return ok({ session: toSessionSummaryResponse(updated) });
  } catch (error) {
    console.error('chat.sessionsUpdate error', error);
    return serverError(error);
  }
};

const generateSessionTitle = async (
  client: OpenAI,
  model: string,
  history: ResponseMessageInput[]
): Promise<string | undefined> => {
  try {
    const prompt: ResponseMessageInput[] = [
      {
        role: 'system',
        content:
          'Generate a short, descriptive title (max 7 words) for the conversation. Respond with title only.'
      },
      ...history
    ];

    const response = await client.responses.create({
      model,
      input: prompt
    });

    const title = extractTextFromResponse(response);
    return title ? title.replace(/["']/g, '').trim() : undefined;
  } catch (error) {
    console.error('Failed to generate session title', error);
    return undefined;
  }
};

export const sessionsMessages: APIGatewayProxyHandlerV2 = async (event) => {
  const sessionId = event.pathParameters?.sessionId;
  if (!sessionId) {
    return badRequest('sessionId is required');
  }

  if (!event.body) {
    return badRequest('Request body is required');
  }

  const userId = getUserId(event.requestContext);
  const payload = JSON.parse(event.body) as {
    message?: string;
    connectionId?: string;
  };

  if (!payload.message || !payload.message.trim()) {
    return badRequest('message is required');
  }

  try {
    let session = await getSession(userId, sessionId);
    if (!session) {
      return badRequest('Session not found');
    }

    const connectionId = payload.connectionId ?? session.liveConnectionId;
    if (!connectionId) {
      return badRequest('connectionId is required');
    }

    const connection = await getConnection(connectionId);
    if (!connection || connection.userId !== userId) {
      return badRequest('Connection is not registered for this user');
    }

    const providerKey = session.providerId;
    const apiKey = await getProviderApiKey(providerKey);
    const client = new OpenAI({ apiKey });

    if (session.liveConnectionId !== connectionId) {
      session = await updateSessionMetadata(session, {
        liveConnectionId: connectionId
      });
    }

    const now = new Date();
    const userMessageId = randomUUID();

    await saveMessage({
      sessionId,
      isoTimestamp: now.toISOString(),
      messageId: userMessageId,
      role: 'user',
      content: payload.message.trim(),
      provider: providerKey,
      createdBy: userId
    });

    session = await updateSessionMetadata(session, {
      lastInteractionAt: now.toISOString()
    });

    const history = await listMessages(sessionId);
    const inputMessages = mapEventsToInput(history);
    const userMessageCount = history.filter(
      (event) => event.eventType === 'message' && event.role === 'user'
    ).length;
    const shouldGenerateTitle = !session.title && userMessageCount === 1;

    const assistantMessageId = randomUUID();
    await sendToConnection(connectionId, {
      type: 'assistant.started',
      sessionId,
      messageId: assistantMessageId
    });

    let assistantContent = '';
    let outputTokens: number | undefined;
    let inputTokens: number | undefined;

    const stream = client.responses.stream({
      model: session.model,
      input: inputMessages
    });

    for await (const eventChunk of stream) {
      if (eventChunk.type === 'response.output_text.delta') {
        const delta = eventChunk.delta ?? '';
        if (delta) {
          assistantContent += delta;
          await sendToConnection(connectionId, {
            type: 'assistant.delta',
            sessionId,
            messageId: assistantMessageId,
            delta
          });
        }
      } else if (eventChunk.type === 'response.completed') {
        const usage = eventChunk.response?.usage;
        inputTokens = usage?.input_tokens ?? inputTokens;
        outputTokens = usage?.output_tokens ?? outputTokens;
      }
    }

    const finalResponse = await stream.finalResponse();
    if (!assistantContent) {
      assistantContent = extractTextFromResponse(finalResponse);
    }

    const assistantTimestamp = new Date().toISOString();
    await saveMessage({
      sessionId,
      isoTimestamp: assistantTimestamp,
      messageId: assistantMessageId,
      role: 'assistant',
      content: assistantContent,
      provider: providerKey,
      tokensIn: inputTokens,
      tokensOut: outputTokens,
      createdBy: providerKey
    });

    await sendToConnection(connectionId, {
      type: 'assistant.completed',
      sessionId,
      messageId: assistantMessageId,
      content: assistantContent
    });

    // Update session with new timestamp (captures new version)
    session = await updateSessionMetadata(session, {
      lastInteractionAt: assistantTimestamp
    });

    if (shouldGenerateTitle) {
      const title = await generateSessionTitle(client, session.model, [
        ...inputMessages,
        {
          role: 'assistant',
          content: assistantContent
        }
      ]);
      if (title) {
        // Use updated session from previous update to avoid version conflict
        session = await updateSessionMetadata(session, { title });
        await sendToConnection(connectionId, {
          type: 'session.title',
          sessionId,
          title
        });
      }
    }

    return ok({
      sessionId,
      userMessageId,
      assistantMessageId
    });
  } catch (error) {
    console.error('chat.sessionsMessages error', error);
    if (payload.connectionId) {
      await sendToConnection(payload.connectionId, {
        type: 'assistant.error',
        sessionId,
        message: (error as Error).message ?? 'Unexpected error generating response'
      });
    }
    return serverError(error);
  }
};

export const sessionsDelete: APIGatewayProxyHandlerV2 = async (event) => {
  try {
    const sessionId = event.pathParameters?.sessionId;
    if (!sessionId) {
      return badRequest('sessionId is required');
    }

    const userId = getUserId(event.requestContext);
    const session = await getSession(userId, sessionId);

    if (!session) {
      return badRequest('Session not found');
    }

    await removeSession(session);

    return ok({ success: true });
  } catch (error) {
    console.error('chat.sessionsDelete error', error);
    return serverError(error);
  }
};
