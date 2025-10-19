import { CognitoIdentityProviderClient } from '@aws-sdk/client-cognito-identity-provider';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { SNSClient } from '@aws-sdk/client-sns';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

const dynamoClient = new DynamoDBClient({});
export const docClient = DynamoDBDocumentClient.from(dynamoClient, {
  marshallOptions: { convertEmptyValues: true, removeUndefinedValues: true }
});

export const secretsManager = new SecretsManagerClient({});
export const snsClient = new SNSClient({});
export const cognitoClient = new CognitoIdentityProviderClient({});
