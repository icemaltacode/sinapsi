import {
  CreateSecretCommand,
  DeleteSecretCommand,
  GetSecretValueCommand,
  PutSecretValueCommand
} from '@aws-sdk/client-secrets-manager';

import { secretsManager } from '../lib/clients';
import { PROVIDER_SECRET_PREFIX } from '../lib/env';
import { getProviderConfig, saveProviderConfig } from '../repositories/providers';

const cache = new Map<string, string>();

const buildSecretName = (provider: string) =>
  `${PROVIDER_SECRET_PREFIX}${provider.toLowerCase()}`;

export const storeProviderApiKey = async (provider: string, apiKey: string) => {
  const secretId = buildSecretName(provider);
  try {
    await secretsManager.send(
      new CreateSecretCommand({
        Name: secretId,
        SecretString: apiKey
      })
    );
  } catch (error) {
    if ((error as { name?: string }).name !== 'ResourceExistsException') {
      throw error;
    }

    await secretsManager.send(
      new PutSecretValueCommand({
        SecretId: secretId,
        SecretString: apiKey
      })
    );
  }

  cache.set(secretId, apiKey);
  return secretId;
};

export const getProviderApiKey = async (provider: string): Promise<string> => {
  const config = await getProviderConfig(provider);

  if (!config) {
    throw new Error(`Provider ${provider} has not been configured`);
  }

  const secretId = config.secretId;

  const cached = cache.get(secretId);
  if (cached) {
    return cached;
  }

  const secretValue = await secretsManager.send(
    new GetSecretValueCommand({
      SecretId: secretId
    })
  );

  const apiKey =
    secretValue.SecretString ??
    (secretValue.SecretBinary ? Buffer.from(secretValue.SecretBinary).toString('utf-8') : null);

  if (!apiKey) {
    throw new Error(`Secret ${secretId} does not contain an API key`);
  }

  cache.set(secretId, apiKey);
  return apiKey;
};

export const ensureProviderConfigExists = async (provider: string, secretId: string) => {
  const existing = await getProviderConfig(provider);
  if (!existing) {
    await saveProviderConfig({ provider, secretId, status: 'active' });
  }
};

export const deleteProviderApiKey = async (provider: string) => {
  const secretId = buildSecretName(provider);

  try {
    await secretsManager.send(
      new DeleteSecretCommand({
        SecretId: secretId,
        ForceDeleteWithoutRecovery: true
      })
    );
  } catch (error) {
    if ((error as { name?: string }).name !== 'ResourceNotFoundException') {
      throw error;
    }
  }

  cache.delete(secretId);
};
