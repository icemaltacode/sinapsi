import { CognitoJwtVerifier } from 'aws-jwt-verify';

const userPoolId = process.env.USER_POOL_ID;
const clientId = process.env.USER_POOL_CLIENT_ID;

if (!userPoolId || !clientId) {
  throw new Error('USER_POOL_ID and USER_POOL_CLIENT_ID must be configured');
}

const verifier = CognitoJwtVerifier.create({
  userPoolId,
  clientId,
  tokenUse: 'id'
});

export interface VerifiedToken {
  sub: string;
  email?: string;
  [key: string]: unknown;
}

export const verifyIdToken = async (token: string): Promise<VerifiedToken> => {
  const payload = await verifier.verify(token);
  return payload as VerifiedToken;
};
