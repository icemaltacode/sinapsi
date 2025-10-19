import type {
  APIGatewayProxyResultV2,
  APIGatewayProxyWebsocketEventV2
} from 'aws-lambda';

const response = (statusCode: number, body?: unknown): APIGatewayProxyResultV2 => ({
  statusCode,
  body: body ? JSON.stringify(body) : undefined
});

type Handler = (event: APIGatewayProxyWebsocketEventV2) => Promise<APIGatewayProxyResultV2>;

export const connect: Handler = async (event) => {
  console.log('WebSocket connect', event.requestContext.connectionId);

  // TODO: Persist connection metadata for streaming responses.
  return response(200, { message: 'Connected' });
};

export const disconnect: Handler = async (event) => {
  console.log('WebSocket disconnect', event.requestContext.connectionId);

  // TODO: Remove connection metadata from storage.
  return response(200, { message: 'Disconnected' });
};

export const defaultHandler: Handler = async (event) => {
  console.log('WebSocket default route payload', event.body);

  // TODO: Route streaming messages to the appropriate provider proxy.
  return response(200, { message: 'Streaming not implemented yet' });
};
