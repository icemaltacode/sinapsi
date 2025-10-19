import type { APIGatewayProxyHandlerV2 } from 'aws-lambda';

import { badRequest, ok, serverError } from '../lib/response';

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  try {
    const sessionId = event.pathParameters?.sessionId;

    if (!sessionId) {
      return badRequest('sessionId is required');
    }

    // TODO: Retrieve chat transcript from DynamoDB once data model is finalised.
    return ok({
      sessionId,
      transcript: [],
      message: 'Transcript persistence not implemented yet'
    });
  } catch (error) {
    console.error('chat-history.handler error', error);
    return serverError(error);
  }
};
