import { Amplify } from 'aws-amplify';

const required = (value: string | undefined, name: string) => {
  if (!value) {
    throw new Error(`Missing environment variable ${name}`);
  }

  return value;
};

const region = required(import.meta.env.VITE_AWS_REGION, 'VITE_AWS_REGION');
const userPoolId = required(
  import.meta.env.VITE_COGNITO_USER_POOL_ID,
  'VITE_COGNITO_USER_POOL_ID'
);
const userPoolClientId = required(
  import.meta.env.VITE_COGNITO_USER_POOL_CLIENT_ID,
  'VITE_COGNITO_USER_POOL_CLIENT_ID'
);

Amplify.configure({
  Auth: {
    Cognito: {
      userPoolId,
      userPoolClientId,
      loginWith: {
        email: true
      }
    }
  }
});

export const awsRegion = region;
