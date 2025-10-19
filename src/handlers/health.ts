import type { APIGatewayProxyHandlerV2 } from 'aws-lambda';

import { STAGE } from '../lib/env';
import { ok } from '../lib/response';

export const handler: APIGatewayProxyHandlerV2 = async () =>
  ok({
    status: 'ok',
    stage: STAGE,
    timestamp: new Date().toISOString()
  });
