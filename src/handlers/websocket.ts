import {
  ApiGatewayManagementApiClient,
  PostToConnectionCommand
} from '@aws-sdk/client-apigatewaymanagementapi';
import type {
  APIGatewayProxyResultV2,
  APIGatewayProxyWebsocketEventV2
} from 'aws-lambda';

import { deleteConnection, registerConnection } from '../repositories/websocket-connections';
import { verifyIdToken } from '../services/token-verifier';

const response = (statusCode: number, body?: unknown): APIGatewayProxyResultV2 => ({
  statusCode,
  body: body ? JSON.stringify(body) : undefined
});

type Handler = (event: APIGatewayProxyWebsocketEventV2) => Promise<APIGatewayProxyResultV2>;

const managementUrl = process.env.WEBSOCKET_MANAGEMENT_URL;
if (!managementUrl) {
  throw new Error('WEBSOCKET_MANAGEMENT_URL must be configured');
}

const apiGateway = new ApiGatewayManagementApiClient({
  endpoint: managementUrl
});

const sendToConnection = async (connectionId: string, payload: unknown) => {
  await apiGateway.send(
    new PostToConnectionCommand({
      ConnectionId: connectionId,
      Data: Buffer.from(JSON.stringify(payload))
    })
  );
};

export const connect: Handler = async (event) => {
  console.log('WebSocket connect', event.requestContext.connectionId);

  return response(200, { message: 'Connected' });
};

export const disconnect: Handler = async (event) => {
  console.log('WebSocket disconnect', event.requestContext.connectionId);

  if (event.requestContext.connectionId) {
    try {
      await deleteConnection(event.requestContext.connectionId);
    } catch (error) {
      console.error('Failed to remove WebSocket connection', error);
    }
  }

  return response(200, { message: 'Disconnected' });
};

export const defaultHandler: Handler = async (event) => {
  console.log('WebSocket default route payload', event.body);

  if (!event.body) {
    return response(400, { message: 'Payload required' });
  }

  try {
    const data = JSON.parse(event.body) as { type?: string; token?: string };

    if (data.type === 'register') {
      if (!data.token) {
        return response(400, { message: 'token is required' });
      }

      const payload = await verifyIdToken(data.token);
      const connectionId = event.requestContext.connectionId;
      if (!connectionId) {
        return response(500, { message: 'Connection id missing' });
      }

      const record = await registerConnection({ connectionId, userId: payload.sub });
      await sendToConnection(connectionId, {
        type: 'connection.registered',
        connectionId: record.connectionId
      });
      return response(200, { message: 'Registered connection' });
    }

    if (data.type === 'ping') {
      return response(200, { message: 'pong' });
    }

    return response(400, { message: 'Unknown event type' });
  } catch (error) {
    console.error('WebSocket default handler error', error);
    return response(500, { message: 'Internal error' });
  }
};
