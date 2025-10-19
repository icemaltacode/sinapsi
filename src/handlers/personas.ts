import type { APIGatewayProxyHandlerV2 } from 'aws-lambda';

import { getUserId } from '../lib/auth';
import { badRequest, created, ok, serverError } from '../lib/response';

export const list: APIGatewayProxyHandlerV2 = async (event) => {
  try {
    const userId = getUserId(event.requestContext);

    // TODO: Query DynamoDB for personas respecting sharing settings.
    return ok({
      items: [],
      userId,
      message: 'Persona storage not implemented yet'
    });
  } catch (error) {
    console.error('personas.list error', error);
    return serverError(error);
  }
};

interface SavePersonaPayload {
  personaId?: string;
  name: string;
  description?: string;
  systemPrompt: string;
  guardrails?: string[];
  isShared?: boolean;
}

const parsePayload = (body: string): SavePersonaPayload => JSON.parse(body);

export const save: APIGatewayProxyHandlerV2 = async (event) => {
  try {
    if (!event.body) {
      return badRequest('Request body is required');
    }

    const payload = parsePayload(event.body);

    if (!payload.name || !payload.systemPrompt) {
      return badRequest('name and systemPrompt are required');
    }

    // TODO: Persist persona in DynamoDB and enforce guardrails.
    const personaId = payload.personaId ?? 'persona-placeholder';

    return created({
      personaId,
      message: 'Persona persistence not implemented yet'
    });
  } catch (error) {
    console.error('personas.save error', error);
    return serverError(error);
  }
};
