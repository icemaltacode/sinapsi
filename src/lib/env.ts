const getEnv = (key: string, defaultValue?: string): string => {
  const value = process.env[key] ?? defaultValue;
  if (value === undefined) {
    throw new Error(`Missing required environment variable ${key}`);
  }

  return value;
};

const getNumberEnv = (key: string, defaultValue?: number): number => {
  const raw = process.env[key];
  if (raw === undefined || raw === '') {
    if (defaultValue === undefined) {
      throw new Error(`Missing required numeric environment variable ${key}`);
    }
    return defaultValue;
  }

  const parsed = Number(raw);
  if (Number.isNaN(parsed)) {
    throw new Error(`Environment variable ${key} must be a valid number`);
  }
  return parsed;
};

export const STAGE = getEnv('STAGE', 'dev');
export const APP_TABLE_NAME = getEnv('APP_TABLE_NAME');
export const PROVIDER_SECRET_PREFIX = getEnv('PROVIDER_SECRET_PREFIX');
export const USAGE_TOPIC_ARN = getEnv('USAGE_TOPIC_ARN');
export const USER_POOL_ID = getEnv('USER_POOL_ID');
export const USER_POOL_CLIENT_ID = getEnv('USER_POOL_CLIENT_ID');
export const DEFAULT_USER_TEMP_PASSWORD = getEnv(
  'DEFAULT_USER_TEMP_PASSWORD',
  'Student1234!'
);
export const ADMIN_TEMP_PASSWORD = getEnv('ADMIN_TEMP_PASSWORD', 'ChangeMe123!');
export const DEFAULT_OPENAI_MONTHLY_TOKENS = getNumberEnv(
  'DEFAULT_OPENAI_MONTHLY_TOKENS',
  200_000
);
export const DEFAULT_OPENAI_MONTHLY_SPEND_GBP = getNumberEnv(
  'DEFAULT_OPENAI_MONTHLY_SPEND_GBP',
  50
);
export const BALDRICK_MODEL = getEnv('BALDRICK_MODEL', 'gpt-4o-mini');

export { getEnv, getNumberEnv };
