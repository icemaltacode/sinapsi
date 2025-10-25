import { randomUUID } from 'node:crypto';
import type { Readable } from 'node:stream';

import {
  ApiGatewayManagementApiClient,
  PostToConnectionCommand
} from '@aws-sdk/client-apigatewaymanagementapi';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import type { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import OpenAI from 'openai';
import type { ResponseCreateParamsNonStreaming } from 'openai/resources/responses/responses';

import { getUserId } from '../lib/auth';
import { askBaldrickToClassify, detectImageAspectRatio } from '../lib/baldrick';
import type { SessionEventItem, SessionSummaryItem } from '../lib/dynamo';
import { badRequest, ok, serverError } from '../lib/response';
import { generatePresignedPutUrl, generatePresignedGetUrl, deleteFilesFromS3 } from '../lib/s3-helpers';
import {
  createSession,
  deleteSession as removeSession,
  getSession,
  listMessages,
  listSessions,
  saveMessage,
  updateSessionMetadata
} from '../repositories/chat-sessions';
import { getModelCache, isCacheStale, type ModelData } from '../repositories/model-cache';
import { getProviderConfig, listProviderConfigs } from '../repositories/providers';
import { deleteConnection as removeConnection, getConnection } from '../repositories/websocket-connections';
import { getProviderApiKey } from '../services/provider-secrets';

type ProviderModel = {
  id: string;
  label: string;
  supportsImageGeneration?: boolean | null;
  supportsTTS?: boolean | null;
  supportsTranscription?: boolean | null;
  supportsFileUpload?: boolean | null;
};

type ProviderEntry = {
  providerId: string;
  providerType: string;
  instanceName: string;
  models: ProviderModel[];
};

// OpenAI Responses API types (matching SDK)
type ResponseInputText = {
  type: 'input_text';
  text: string;
};

type ResponseInputImage = {
  type: 'input_image';
  image_url: string;
  detail?: 'low' | 'high' | 'auto';
};

type ResponseInputFile = {
  type: 'input_file';
  filename: string;
  file_data: string; // Format: "data:application/pdf;base64,{base64string}"
};

type ResponseInputContent = ResponseInputText | ResponseInputImage | ResponseInputFile;

type EasyInputMessage = {
  role: 'user' | 'assistant' | 'system' | 'developer';
  content: string | ResponseInputContent[];
};

const WEBSOCKET_MANAGEMENT_URL = process.env.WEBSOCKET_MANAGEMENT_URL;
const GENERATED_IMAGES_BUCKET = process.env.GENERATED_IMAGES_BUCKET;
const USER_UPLOADS_BUCKET = process.env.USER_UPLOADS_BUCKET;

if (!WEBSOCKET_MANAGEMENT_URL) {
  throw new Error('WEBSOCKET_MANAGEMENT_URL is not configured');
}

if (!GENERATED_IMAGES_BUCKET) {
  throw new Error('GENERATED_IMAGES_BUCKET is not configured');
}

const wsClient = new ApiGatewayManagementApiClient({
  endpoint: WEBSOCKET_MANAGEMENT_URL
});

const s3Client = new S3Client({});

// Helper to download file from S3 and convert to base64
const downloadAndEncodeFile = async (fileKey: string): Promise<string> => {
  const command = new GetObjectCommand({
    Bucket: USER_UPLOADS_BUCKET,
    Key: fileKey
  });

  const response = await s3Client.send(command);
  const bodyStream = response.Body as Readable | undefined;
  if (!bodyStream) {
    throw new Error(`Failed to download file: ${fileKey}`);
  }

  // Convert stream to buffer
  const chunks: Buffer[] = [];
  for await (const chunk of bodyStream as AsyncIterable<Uint8Array | Buffer>) {
    const bufferChunk = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    chunks.push(bufferChunk);
  }
  const buffer = Buffer.concat(chunks);
  return buffer.toString('base64');
};

const modelCache = new Map<string, { expiresAt: number; models: ProviderModel[] }>();
const MODEL_CACHE_TTL_MS = 5 * 60 * 1000;

const guessProviderType = (providerId: string, providerType?: string): string => {
  if (providerType) {
    return providerType;
  }

  const id = providerId.toLowerCase();
  if (id.includes('openai') || id.includes('gpt')) {
    return 'openai';
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

  return 'openai';
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
  // Check in-memory cache first (5 minute TTL)
  const memCacheKey = `${providerType}:${providerId}`;
  const memCached = modelCache.get(memCacheKey);
  if (memCached && memCached.expiresAt > Date.now()) {
    return memCached.models;
  }

  // Try DynamoDB cache (7 day TTL)
  try {
    const dbCache = await getModelCache(providerId);
    if (dbCache && !isCacheStale(dbCache)) {
      console.log(`[Model Cache] Using cached models from DynamoDB for ${providerId} (${dbCache.models.length} models)`);

      // Filter out blacklisted models
      const models: ProviderModel[] = (dbCache.models as ModelData[])
        .filter((m) => !m.blacklisted)
        .map((m) => ({
          id: m.id,
          label: m.label,
          supportsImageGeneration: m.supportsImageGeneration,
          supportsTTS: m.supportsTTS,
          supportsTranscription: m.supportsTranscription,
          supportsFileUpload: m.supportsFileUpload ?? null
        }));

      // Update in-memory cache
      modelCache.set(memCacheKey, { models, expiresAt: Date.now() + MODEL_CACHE_TTL_MS });

      return models;
    }

    if (dbCache && isCacheStale(dbCache)) {
      console.warn(`[Model Cache] Cache is stale for ${providerId} (last refresh: ${dbCache.lastRefreshed})`);
    }
  } catch (error) {
    console.error('[Model Cache] Failed to read from DynamoDB, falling back to dynamic fetch:', error);
  }

  // Fallback: Dynamic fetch from provider API
  console.warn(`[Model Cache] Cache miss for ${providerId}, using dynamic fetch`);

  let models: ProviderModel[] = [];

  if (providerType === 'openai') {
    const apiKey = await getProviderApiKey(providerId);
    models = await fetchOpenAIModels(apiKey);
  }

  // Update in-memory cache
  modelCache.set(memCacheKey, { models, expiresAt: Date.now() + MODEL_CACHE_TTL_MS });

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

const detectImageGenerationIntent = async (
  message: string,
  attachments: Array<{
    fileKey: string;
    fileName: string;
    fileType: string;
    fileSize: number;
  }> | undefined,
  apiKey: string
): Promise<boolean> => {
  const lowerMessage = message.toLowerCase();

  // If the user attached files, assume they want analysis of uploads, not new image generation
  if (attachments && attachments.length > 0) {
    return false;
  }

  // Image-related keywords
  const imageTerms = ['image', 'picture', 'photo', 'illustration', 'drawing', 'artwork', 'graphic'];
  const actionTerms = ['generate', 'create', 'make', 'draw', 'produce', 'design', 'show me'];

  // Check if message contains both action and image terms
  const hasImageTerm = imageTerms.some((term) => lowerMessage.includes(term));
  const hasActionTerm = actionTerms.some((term) => lowerMessage.includes(term));

  // Common patterns
  const patterns = [
    /\b(an?|the)\s+(image|picture|photo|illustration)\s+of\b/i,
    /\bshow\s+me\s+(an?|the|some)\s+(image|picture|photo)\b/i,
    /\b(generate|create|make|draw)\s+.*\s+(image|picture|photo|illustration)\b/i
  ];

  const hasPattern = patterns.some((pattern) => pattern.test(message));

  const likelyImagePrompt = (hasImageTerm && hasActionTerm) || hasPattern;

  if (!likelyImagePrompt) {
    return false;
  }

  try {
    const answer = await askBaldrickToClassify(
      `A user wrote: "${message}".
Determine if they are asking the assistant to GENERATE a new image (answer "yes") or do something else such as describing, editing, or analysing an existing image (answer "no").
Reply with just yes or no.`,
      apiKey,
      ['yes', 'no'] as const,
      'no'
    );

    return answer === 'yes';
  } catch (error) {
    console.warn('Baldrick image intent classification failed, falling back to heuristic', error);
    return likelyImagePrompt;
  }
};

const supportsNativeImageGeneration = (model: string): boolean => {
  const lowerModel = model.toLowerCase();

  // GPT-4o, GPT-4.1, GPT-5, and o-series models support native image generation
  return (
    lowerModel.includes('gpt-4o') ||
    lowerModel.includes('gpt-4.1') ||
    lowerModel.includes('gpt-5') ||
    lowerModel.startsWith('o1') ||
    lowerModel.startsWith('o3') ||
    lowerModel.startsWith('o4')
  );
};

const generateImageWithDallE = async (
  client: OpenAI,
  prompt: string
): Promise<string> => {
  try {
    const response = await client.images.generate({
      model: 'dall-e-3',
      prompt,
      n: 1,
      size: '1024x1024',
      quality: 'standard'
    });

    const imageUrl = response.data?.[0]?.url;
    if (!imageUrl) {
      throw new Error('No image URL returned from DALL-E');
    }

    return imageUrl;
  } catch (error) {
    console.error('DALL-E image generation failed', error);
    throw error;
  }
};

const generateImageNative = async (
  client: OpenAI,
  model: string,
  prompt: string,
  connectionId: string,
  sessionId: string,
  messageId: string,
  size: '1024x1024' | '1024x1536' | '1536x1024' = '1024x1024'
): Promise<string> => {
  try {
    const startTime = Date.now();
    console.log(`Image generation: Starting with size ${size}, requesting 3 partials`);

    // Use streaming to get progress updates
    const stream = client.responses.stream({
      model,
      input: [{ role: 'user', content: prompt }],
      tools: [
        {
          type: 'image_generation',
          size,
          partial_images: 3  // Request 3 partial images during generation
        }
      ]
    });

    let imageResult: string | null = null;
    let lastPartialUploadTime = 0;
    let partialCount = 0;
    const PARTIAL_UPLOAD_THROTTLE_MS = 10000; // Upload partials every 10 seconds

    for await (const event of stream) {

      if (event.type === 'response.image_generation_call.generating') {
        // Send progress update
        await sendToConnection(connectionId, {
          type: 'assistant.image.progress',
          sessionId,
          messageId,
          message: 'Generating image...'
        });
      } else if (event.type === 'response.image_generation_call.partial_image') {
        // Throttle partial uploads to avoid spam (every 10 seconds)
        const now = Date.now();
        if (now - lastPartialUploadTime >= PARTIAL_UPLOAD_THROTTLE_MS) {
          partialCount++;
          const partialImageData = (event as { partial_image_b64?: string }).partial_image_b64;
          if (partialImageData) {
            console.log(`Image generation: Uploading partial ${partialCount}/3 to S3`);
            try {
              // Convert base64 to buffer
              const imageBuffer = Buffer.from(partialImageData, 'base64');

              // Upload to S3 with partials/ prefix (will be auto-deleted after 1 day)
              const partialFilename = `partials/${sessionId}/${messageId}/${Date.now()}.png`;
              await s3Client.send(
                new PutObjectCommand({
                  Bucket: GENERATED_IMAGES_BUCKET,
                  Key: partialFilename,
                  Body: imageBuffer,
                  ContentType: 'image/png',
                  ACL: 'public-read'
                })
              );

              // Send S3 URL via WebSocket
              const region = process.env.AWS_REGION || 'eu-south-1';
              const partialImageUrl = `https://${GENERATED_IMAGES_BUCKET}.s3.${region}.amazonaws.com/${partialFilename}`;

              await sendToConnection(connectionId, {
                type: 'assistant.image.partial',
                sessionId,
                messageId,
                imageUrl: partialImageUrl,
                partialCount
              });

              lastPartialUploadTime = now;
              console.log(`Image generation: Partial ${partialCount}/3 uploaded to S3`);
            } catch (error) {
              console.error('Failed to upload partial image, continuing...', error);
              // Don't throw - partial upload failure shouldn't kill the whole generation
            }
          }
        }
      }
    }

    // Get the final response
    const finalResponse = await stream.finalResponse();
    console.log('Final response status:', finalResponse.status);

    // Extract image data from output
    const imageOutput = finalResponse.output?.find(
      (item: { type?: string }) => item.type === 'image_generation_call'
    ) as { result?: string | null; status?: string } | undefined;

    if (!imageOutput) {
      throw new Error('No image_generation_call in response output');
    }

    if (imageOutput.status === 'failed') {
      throw new Error('Image generation failed');
    }

    if (!imageOutput.result) {
      throw new Error('No image data in response');
    }

    imageResult = imageOutput.result;

    // The result is base64 encoded - upload to S3
    console.log('Image returned as base64, uploading to S3...');

    // Convert base64 to buffer
    const imageBuffer = Buffer.from(imageResult, 'base64');

    // Generate unique filename
    const filename = `${sessionId}/${messageId}.png`;

    // Upload to S3
    await s3Client.send(
      new PutObjectCommand({
        Bucket: GENERATED_IMAGES_BUCKET,
        Key: filename,
        Body: imageBuffer,
        ContentType: 'image/png',
        ACL: 'public-read'
      })
    );

    // Construct the public URL
    const region = process.env.AWS_REGION || 'eu-south-1';
    const imageUrl = `https://${GENERATED_IMAGES_BUCKET}.s3.${region}.amazonaws.com/${filename}`;

    const duration = Date.now() - startTime;
    console.log(`Image generation: Final image uploaded to S3`);
    console.log(`Image generation: Complete in ${duration}ms`);
    return imageUrl;
  } catch (error) {
    console.error('Native image generation failed', error);
    throw error;
  }
};

const mapEventsToInput = async (events: SessionEventItem[]): Promise<EasyInputMessage[]> => {
  const messages: EasyInputMessage[] = [];

  for (const event of events) {
    if (event.eventType !== 'message') continue;

    // If no attachments, just use simple text content
    if (!event.attachments || event.attachments.length === 0) {
      messages.push({
        role: event.role,
        content: event.content
      });
      continue;
    }

    // Build multimodal content array
    const contentParts: ResponseInputContent[] = [];

    // Add text first if present
    if (event.content && event.content.trim()) {
      contentParts.push({
        type: 'input_text',
        text: event.content
      });
    }

    // Add attachments
    for (const attachment of event.attachments) {
      // Determine content type based on MIME type
      const isImage = attachment.fileType.startsWith('image/');
      const isPdf = attachment.fileType === 'application/pdf';

      if (isImage) {
        // Images: use presigned URL
        const presignedUrl = await generatePresignedGetUrl(attachment.fileKey, 3600); // 1 hour for OpenAI processing
        contentParts.push({
          type: 'input_image',
          image_url: presignedUrl,
          detail: 'auto'
        });
      } else if (isPdf) {
        // PDFs: download and base64 encode
        try {
          const base64Data = await downloadAndEncodeFile(attachment.fileKey);
          contentParts.push({
            type: 'input_file',
            filename: attachment.fileName,
            file_data: `data:application/pdf;base64,${base64Data}`
          });
        } catch (error) {
          console.error(`Failed to encode PDF ${attachment.fileName}:`, error);
          // Skip this attachment if encoding fails
        }
      } else {
        // For other file types, we can't send them to OpenAI
        // Just skip or log - frontend should handle this validation
        console.warn(`Unsupported file type for OpenAI: ${attachment.fileType} (${attachment.fileName})`);
      }
    }

    messages.push({
      role: event.role,
      content: contentParts
    });
  }

  return messages;
};

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
  imageUrl: message.imageUrl,
  imagePrompt: message.imagePrompt,
  attachments: message.attachments,
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
  history: EasyInputMessage[]
): Promise<string | undefined> => {
  try {
    const prompt: EasyInputMessage[] = [
      {
        role: 'system',
        content:
          'Generate a short, descriptive title (max 7 words) for the conversation. Respond with title only.'
      },
      ...history
    ];

    const response = await client.responses.create({
      model,
      input: prompt as unknown as ResponseCreateParamsNonStreaming['input']
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
    role?: 'user' | 'system';
    attachments?: Array<{
      fileKey: string;
      fileName: string;
      fileType: string;
      fileSize: number;
    }>;
  };

  if (!payload.message || !payload.message.trim()) {
    return badRequest('message is required');
  }

  const messageRole = payload.role ?? 'user';

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

    // Validate attachment ownership if provided
    if (payload.attachments && payload.attachments.length > 0) {
      for (const attachment of payload.attachments) {
        // File key format: chat/ice-campus/{userId}/{sessionId}/{fileId}-{fileName}
        const pathParts = attachment.fileKey.split('/');
        if (pathParts.length < 4 || pathParts[2] !== userId || pathParts[3] !== sessionId) {
          return badRequest(`Access denied: Attachment ${attachment.fileName} does not belong to this session`);
        }
      }
    }

    await saveMessage({
      sessionId,
      isoTimestamp: now.toISOString(),
      messageId: userMessageId,
      role: messageRole,
      content: payload.message.trim(),
      attachments: payload.attachments?.map(att => ({
        ...att,
        uploadedAt: now.toISOString()
      })),
      provider: providerKey,
      createdBy: userId
    });

    session = await updateSessionMetadata(session, {
      lastInteractionAt: now.toISOString()
    });

    // If this is a system message, don't trigger assistant response
    if (messageRole === 'system') {
      return ok({
        sessionId,
        userMessageId
      });
    }

    // Check if this is an image generation request
    if (await detectImageGenerationIntent(payload.message.trim(), payload.attachments, apiKey)) {
      const assistantMessageId = randomUUID();
      const userPrompt = payload.message.trim();

      // Image generation runs in this handler
      // API Gateway may timeout after 30s, but Lambda will keep running (900s timeout)
      // Image will be delivered via WebSocket + polling on frontend
      await (async () => {
        let imageUrl: string | undefined;
        let imageGenerationError: Error | undefined;

        try {
          if (supportsNativeImageGeneration(session.model)) {
            // Detect aspect ratio first using Baldrick
            const aspectRatio = await detectImageAspectRatio(userPrompt, apiKey);

            // Send aspect ratio to frontend so it can show placeholder
            await sendToConnection(connectionId, {
              type: 'assistant.image.aspect_detected',
              sessionId,
              messageId: assistantMessageId,
              aspectRatio
            });

            // Map aspect ratio to image size
            const size = aspectRatio === 'portrait' ? '1024x1536' :
                        aspectRatio === 'landscape' ? '1536x1024' :
                        '1024x1024';

            imageUrl = await generateImageNative(
              client,
              session.model,
              userPrompt,
              connectionId,
              sessionId,
              assistantMessageId,
              size
            );
          } else {
            // Fallback to DALL-E for models that don't support native image generation
            await sendToConnection(connectionId, {
              type: 'assistant.image.started',
              sessionId,
              messageId: assistantMessageId
            });

            imageUrl = await generateImageWithDallE(client, userPrompt);
          }
        } catch (error) {
          console.error('Image generation failed', error);
          imageGenerationError = error as Error;
        }

        // ALWAYS save to DynamoDB, even if image generation failed or WebSocket is gone
        // This ensures the message appears in chat history
        const assistantTimestamp = new Date().toISOString();
        try {
          if (imageUrl) {
            // Successful image generation - save with image data
            await saveMessage({
              sessionId,
              isoTimestamp: assistantTimestamp,
              messageId: assistantMessageId,
              role: 'assistant',
              content: `Generated image: ${userPrompt}`,
              imageUrl,
              imagePrompt: userPrompt,
              provider: providerKey,
              createdBy: providerKey
            });
          } else {
            // Image generation failed - save error message
            await saveMessage({
              sessionId,
              isoTimestamp: assistantTimestamp,
              messageId: assistantMessageId,
              role: 'assistant',
              content: `Failed to generate image: ${imageGenerationError?.message || 'Unknown error'}`,
              provider: providerKey,
              createdBy: providerKey
            });
          }

          // Update session timestamp
          session = await updateSessionMetadata(session, {
            lastInteractionAt: assistantTimestamp
          });

          console.log('Image message saved to DynamoDB successfully');

          // Generate title if this is the first user message
          if (!session.title) {
            try {
              const history = await listMessages(sessionId);
              const userMessageCount = history.filter(
                (event) => event.eventType === 'message' && event.role === 'user'
              ).length;

              if (userMessageCount === 1) {
                const title = await generateSessionTitle(client, session.model, [
                  { role: 'user', content: userPrompt },
                  { role: 'assistant', content: `Generated image: ${userPrompt}` }
                ]);

                if (title) {
                  session = await updateSessionMetadata(session, { title });
                  try {
                    await sendToConnection(connectionId, {
                      type: 'session.title',
                      sessionId,
                      title
                    });
                  } catch (wsError) {
                    console.warn('Failed to send title via WebSocket, but saved to DB', wsError);
                  }
                }
              }
            } catch (titleError) {
              console.error('Failed to generate title for image session', titleError);
            }
          }
        } catch (dbError) {
          console.error('CRITICAL: Failed to save image message to DynamoDB', dbError);
        }

        // Try to send via WebSocket (best effort - may fail if connection is gone)
        try {
          if (imageUrl) {
            await sendToConnection(connectionId, {
              type: 'assistant.image.completed',
              sessionId,
              messageId: assistantMessageId,
              imageUrl,
              prompt: userPrompt
            });
          } else {
            await sendToConnection(connectionId, {
              type: 'assistant.error',
              sessionId,
              messageId: assistantMessageId,
              message: 'Failed to generate image. Please try again.'
            });
          }
        } catch (wsError) {
          console.warn('WebSocket send failed (connection may be gone), but message saved to DB', wsError);
        }
      })();

      // Return after image is complete (or API Gateway times out after 30s, whichever comes first)
      return ok({
        sessionId,
        userMessageId,
        assistantMessageId
      });
    }

    const history = await listMessages(sessionId);
    const inputMessages = await mapEventsToInput(history);
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
      input: inputMessages as unknown as ResponseCreateParamsNonStreaming['input']
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

    // Get all messages to find attached files
    const messages = await listMessages(sessionId);
    const fileKeys: string[] = [];

    for (const message of messages) {
      if (message.attachments && Array.isArray(message.attachments)) {
        fileKeys.push(...message.attachments.map((att: { fileKey: string }) => att.fileKey));
      }
    }

    // Delete files from S3
    if (fileKeys.length > 0) {
      try {
        await deleteFilesFromS3(fileKeys);
        console.log(`Deleted ${fileKeys.length} files from S3 for session ${sessionId}`);
      } catch (s3Error) {
        console.error('Failed to delete files from S3', s3Error);
        // Continue with session deletion even if file deletion fails
      }
    }

    await removeSession(session);

    return ok({ success: true });
  } catch (error) {
    console.error('chat.sessionsDelete error', error);
    return serverError(error);
  }
};

export const fileUploadPresign: APIGatewayProxyHandlerV2 = async (event) => {
  try {
    const sessionId = event.pathParameters?.sessionId;
    if (!sessionId) {
      return badRequest('sessionId is required');
    }

    if (!event.body) {
      return badRequest('Request body is required');
    }

    const userId = getUserId(event.requestContext);
    const session = await getSession(userId, sessionId);

    if (!session) {
      return badRequest('Session not found');
    }

    const payload = JSON.parse(event.body) as {
      fileName?: string;
      fileType?: string;
      fileSize?: number;
    };

    if (!payload.fileName || !payload.fileType || !payload.fileSize) {
      return badRequest('fileName, fileType, and fileSize are required');
    }

    // Validate file size (30MB max)
    const MAX_FILE_SIZE = 30 * 1024 * 1024;
    if (payload.fileSize > MAX_FILE_SIZE) {
      return badRequest(`File size exceeds maximum allowed size of ${MAX_FILE_SIZE} bytes`);
    }

    // Generate S3 key: chat/{tenantId}/{userId}/{sessionId}/{uuid}-{fileName}
    const fileId = randomUUID();
    const sanitizedFileName = payload.fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
    const fileKey = `chat/ice-campus/${userId}/${sessionId}/${fileId}-${sanitizedFileName}`;

    // Generate presigned PUT URL (15 minutes expiry)
    const uploadUrl = await generatePresignedPutUrl(fileKey, payload.fileType, 900);

    return ok({
      uploadUrl,
      fileKey,
      expiresAt: new Date(Date.now() + 900 * 1000).toISOString()
    });
  } catch (error) {
    console.error('chat.fileUploadPresign error', error);
    return serverError(error);
  }
};

export const fileGet: APIGatewayProxyHandlerV2 = async (event) => {
  try {
    const fileKey = event.pathParameters?.fileKey;
    if (!fileKey) {
      return badRequest('fileKey is required');
    }

    const userId = getUserId(event.requestContext);

    // Validate that the file belongs to this user
    // File key format: chat/ice-campus/{userId}/{sessionId}/{fileId}-{fileName}
    const pathParts = fileKey.split('/');
    if (pathParts.length < 4 || pathParts[2] !== userId) {
      return badRequest('Access denied: File does not belong to this user');
    }

    // Generate presigned GET URL (7 days expiry)
    const getUrl = await generatePresignedGetUrl(fileKey, 7 * 24 * 60 * 60);

    return ok({
      url: getUrl,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
    });
  } catch (error) {
    console.error('chat.fileGet error', error);
    return serverError(error);
  }
};
