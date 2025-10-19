import type {
  APIGatewayProxyStructuredResultV2,
  APIGatewayProxyResultV2
} from 'aws-lambda';

type Body = Record<string, unknown> | string | null;

const toBody = (payload: Body): string | undefined => {
  if (payload === null) {
    return undefined;
  }

  if (typeof payload === 'string') {
    return payload;
  }

  return JSON.stringify(payload);
};

export const json = (
  statusCode: number,
  body: Body,
  extra: Partial<APIGatewayProxyStructuredResultV2> = {}
): APIGatewayProxyResultV2 => ({
  statusCode,
  headers: {
    'Content-Type': 'application/json; charset=utf-8',
    ...(extra.headers ?? {})
  },
  body: toBody(body),
  ...extra
});

export const ok = (body: Body = null, extra?: Partial<APIGatewayProxyStructuredResultV2>) =>
  json(200, body, extra);

export const created = (
  body: Body = null,
  extra?: Partial<APIGatewayProxyStructuredResultV2>
) => json(201, body, extra);

export const badRequest = (
  message = 'Bad request',
  extra?: Partial<APIGatewayProxyStructuredResultV2>
) => json(400, { message }, extra);

export const unauthorized = (
  message = 'Unauthorized',
  extra?: Partial<APIGatewayProxyStructuredResultV2>
) => json(401, { message }, extra);

export const forbidden = (
  message = 'Forbidden',
  extra?: Partial<APIGatewayProxyStructuredResultV2>
) => json(403, { message }, extra);

export const notFound = (
  message = 'Not found',
  extra?: Partial<APIGatewayProxyStructuredResultV2>
) => json(404, { message }, extra);

export const conflict = (
  message = 'Conflict',
  extra?: Partial<APIGatewayProxyStructuredResultV2>
) => json(409, { message }, extra);

export const serverError = (
  error: unknown,
  extra?: Partial<APIGatewayProxyStructuredResultV2>
) => {
  const message = error instanceof Error ? error.message : 'Internal server error';
  return json(
    500,
    { message },
    extra
  );
};
