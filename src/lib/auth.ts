import type { APIGatewayEventRequestContextV2 } from 'aws-lambda';

type JwtAuthorizerContext = {
  jwt?: {
    claims?: {
      sub?: unknown;
      [key: string]: unknown;
    };
  };
};

type RequestContextWithAuthorizer = APIGatewayEventRequestContextV2 & {
  authorizer?: JwtAuthorizerContext;
};

export const getUserId = (requestContext: APIGatewayEventRequestContextV2): string => {
  const context = requestContext as RequestContextWithAuthorizer;
  const sub = context.authorizer?.jwt?.claims?.sub;
  return typeof sub === 'string' && sub.length > 0 ? sub : 'anonymous';
};
