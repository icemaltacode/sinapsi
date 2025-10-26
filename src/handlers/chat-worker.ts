import type { Readable } from 'node:stream';

import {
  ApiGatewayManagementApiClient,
  PostToConnectionCommand
} from '@aws-sdk/client-apigatewaymanagementapi';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import type { Handler } from 'aws-lambda';

import { getChatAdapter, type ChatMessage } from '../lib/chat-adapters';
import type { SessionEventItem } from '../lib/dynamo';
import { generatePresignedGetUrl } from '../lib/s3-helpers';
import { listMessages, saveMessage, updateSessionMetadata, getSession } from '../repositories/chat-sessions';
import { getProviderConfig } from '../repositories/providers';
import { deleteConnection as removeConnection } from '../repositories/websocket-connections';
import { getProviderApiKey } from '../services/provider-secrets';

const WEBSOCKET_MANAGEMENT_URL = process.env.WEBSOCKET_MANAGEMENT_URL;
const USER_UPLOADS_BUCKET = process.env.USER_UPLOADS_BUCKET;
const s3Client = new S3Client({});

type WorkerPayload = {
  sessionId: string;
  userMessageId: string;
  assistantMessageId: string;
  connectionId: string;
  userId: string;
  providerKey: string;
  shouldGenerateTitle: boolean;
};

/**
 * Helper to send WebSocket messages
 */
async function sendToConnection(connectionId: string, payload: unknown): Promise<void> {
  if (!WEBSOCKET_MANAGEMENT_URL) {
    throw new Error('WEBSOCKET_MANAGEMENT_URL not configured');
  }

  const client = new ApiGatewayManagementApiClient({
    endpoint: WEBSOCKET_MANAGEMENT_URL
  });

  try {
    await client.send(
      new PostToConnectionCommand({
        ConnectionId: connectionId,
        Data: Buffer.from(JSON.stringify(payload))
      })
    );
  } catch (error: unknown) {
    // Connection is stale - remove it
    if ((error as { statusCode?: number }).statusCode === 410) {
      console.log(`Connection ${connectionId} is stale, removing`);
      await removeConnection(connectionId);
      throw new Error('WebSocket connection is stale');
    }
    throw error;
  }
}

/**
 * Download file from S3 and encode as base64
 */
async function downloadAndEncodeFile(fileKey: string): Promise<string> {
  if (!USER_UPLOADS_BUCKET) {
    throw new Error('USER_UPLOADS_BUCKET not configured');
  }

  const response = await s3Client.send(
    new GetObjectCommand({
      Bucket: USER_UPLOADS_BUCKET,
      Key: fileKey
    })
  );

  if (!response.Body) {
    throw new Error(`File ${fileKey} has no body`);
  }

  // Convert stream to buffer
  const chunks: Uint8Array[] = [];
  for await (const chunk of response.Body as Readable) {
    chunks.push(chunk as Uint8Array);
  }
  const buffer = Buffer.concat(chunks);

  return buffer.toString('base64');
}

/**
 * Maps DynamoDB session events to unified ChatMessage format
 */
async function mapEventsToInput(events: SessionEventItem[]): Promise<ChatMessage[]> {
  const messages: ChatMessage[] = [];

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
    const contentParts: Array<
      | { type: 'text'; text: string }
      | { type: 'image'; imageUrl: string; detail?: 'low' | 'high' | 'auto' }
      | { type: 'document'; fileName: string; fileData: string }
    > = [];

    // Add text first if present
    if (event.content && event.content.trim()) {
      contentParts.push({
        type: 'text',
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
        const presignedUrl = await generatePresignedGetUrl(attachment.fileKey, 3600);
        contentParts.push({
          type: 'image',
          imageUrl: presignedUrl,
          detail: 'auto'
        });
      } else if (isPdf) {
        // PDFs: download and base64 encode
        try {
          const base64Data = await downloadAndEncodeFile(attachment.fileKey);
          contentParts.push({
            type: 'document',
            fileName: attachment.fileName,
            fileData: `data:application/pdf;base64,${base64Data}`
          });
        } catch (error) {
          console.error(`Failed to encode PDF ${attachment.fileName}:`, error);
          // Skip this attachment if encoding fails
        }
      } else {
        console.warn(`Unsupported file type: ${attachment.fileType} (${attachment.fileName})`);
      }
    }

    messages.push({
      role: event.role,
      content: contentParts
    });
  }

  return messages;
}

/**
 * Generate a session title using the LLM
 */
async function generateSessionTitle(
  adapter: ReturnType<typeof getChatAdapter>,
  model: string,
  messages: ChatMessage[]
): Promise<string | null> {
  try {
    const titlePrompt: ChatMessage[] = [
      {
        role: 'system',
        content:
          'Generate a brief, descriptive title (max 6 words) for this conversation. Return only the title, no quotes or extra text.'
      },
      ...messages.slice(-2)
    ];

    const response = await adapter.sendMessage({
      model,
      messages: titlePrompt
    });

    // Consume the stream to get final response
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    for await (const _delta of response.textStream) {
      // Just consume the stream
    }

    const finalResponse = await response.getFinalResponse();
    return finalResponse.content.trim().replace(/^["']|["']$/g, '');
  } catch (error) {
    console.error('Failed to generate title', error);
    return null;
  }
}

/**
 * Worker Lambda handler - performs long-running LLM streaming
 */
export const handler: Handler<WorkerPayload> = async (event) => {
  console.log('Chat worker invoked', { sessionId: event.sessionId });

  const {
    sessionId,
    assistantMessageId,
    connectionId,
    userId,
    providerKey,
    shouldGenerateTitle
  } = event;

  try {
    // Load session
    let session = await getSession(userId, sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    // Get provider config to determine provider type
    const providerConfig = await getProviderConfig(providerKey);
    if (!providerConfig || !providerConfig.providerType) {
      throw new Error(`Provider ${providerKey} not found or missing providerType`);
    }

    // Fetch API key
    const apiKey = await getProviderApiKey(providerKey);
    if (!apiKey) {
      throw new Error(`No API key found for provider ${providerKey}`);
    }

    // Create adapter
    const adapter = getChatAdapter(providerConfig.providerType, apiKey);

    // Load message history
    const history = await listMessages(sessionId);
    const inputMessages = await mapEventsToInput(history);

    // Notify client that assistant is starting
    await sendToConnection(connectionId, {
      type: 'assistant.started',
      sessionId,
      messageId: assistantMessageId
    });

    // Stream the LLM response
    const streamResponse = await adapter.sendMessage({
      model: session.model,
      messages: inputMessages
    });

    // Send deltas to client via WebSocket
    for await (const delta of streamResponse.textStream) {
      await sendToConnection(connectionId, {
        type: 'assistant.delta',
        sessionId,
        messageId: assistantMessageId,
        delta
      });
    }

    // Get final response with token counts
    const finalResponse = await streamResponse.getFinalResponse();
    const assistantContent = finalResponse.content;
    const outputTokens = finalResponse.outputTokens;
    const inputTokens = finalResponse.inputTokens;

    // Persist assistant message
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

    // Send completion event
    await sendToConnection(connectionId, {
      type: 'assistant.completed',
      sessionId,
      messageId: assistantMessageId,
      content: assistantContent
    });

    // Update session timestamp
    session = await updateSessionMetadata(session, {
      lastInteractionAt: assistantTimestamp
    });

    // Generate title if needed
    if (shouldGenerateTitle) {
      const title = await generateSessionTitle(adapter, session.model, [
        ...inputMessages,
        {
          role: 'assistant',
          content: assistantContent
        }
      ]);

      if (title) {
        session = await updateSessionMetadata(session, { title });
        await sendToConnection(connectionId, {
          type: 'session.title',
          sessionId,
          title
        });
      }
    }

    console.log('Chat worker completed successfully', { sessionId });
  } catch (error) {
    console.error('Chat worker error', error);

    // Try to send error to client via WebSocket
    try {
      await sendToConnection(connectionId, {
        type: 'assistant.error',
        sessionId,
        message: (error as Error).message ?? 'Unexpected error generating response'
      });
    } catch (wsError) {
      console.error('Failed to send error via WebSocket', wsError);
    }

    // Don't throw - we don't want Lambda to retry
    // The error has been communicated to the client
  }
};
