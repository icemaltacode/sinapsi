import type { APIGatewayProxyHandlerV2 } from 'aws-lambda';

import { getUserId } from '../lib/auth';
import { badRequest, created, ok, serverError } from '../lib/response';

export const list: APIGatewayProxyHandlerV2 = async (event) => {
  try {
    const userId = getUserId(event.requestContext);

    // TODO: Query DynamoDB for prompts belonging to the user or org.
    return ok({
      items: [],
      userId,
      message: 'Prompt storage not implemented yet'
    });
  } catch (error) {
    console.error('prompts.list error', error);
    return serverError(error);
  }
};

interface SavePromptPayload {
  promptId?: string;
  name: string;
  body: string;
  variables?: string[];
  isShared?: boolean;
}

const parsePayload = (body: string): SavePromptPayload => JSON.parse(body);

export const save: APIGatewayProxyHandlerV2 = async (event) => {
  try {
    if (!event.body) {
      return badRequest('Request body is required');
    }

    const payload = parsePayload(event.body);

    if (!payload.name || !payload.body) {
      return badRequest('name and body are required');
    }

    // TODO: Persist prompt in DynamoDB and emit audit event if shared.
    const promptId = payload.promptId ?? 'prompt-placeholder';

    return created({
      promptId,
      message: 'Prompt persistence not implemented yet'
    });
  } catch (error) {
    console.error('prompts.save error', error);
    return serverError(error);
  }
};
