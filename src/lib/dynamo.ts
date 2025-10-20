type KeyAttributes = {
  pk: string;
  sk: string;
  gsi1pk?: string;
  gsi1sk?: string;
  gsi2pk?: string;
  gsi2sk?: string;
};

export const TENANT_ID = 'ice-campus';

const join = (namespace: string, ...parts: Array<string | number>) =>
  [namespace, TENANT_ID, ...parts].join('#');

const timestamp = () => new Date().toISOString();

export const keys = {
  userProfile: (userId: string, email?: string): KeyAttributes => ({
    pk: join('USER', userId),
    sk: 'PROFILE',
    gsi1pk: 'PROFILE',
    gsi1sk: `${TENANT_ID}#${userId}`,
    ...(email
      ? {
          gsi2pk: `USER_EMAIL#${TENANT_ID}`,
          gsi2sk: email.toLowerCase()
        }
      : {})
  }),
  userPrompt: (userId: string, promptId: string): KeyAttributes => ({
    pk: join('USER', userId),
    sk: `PROMPT#${promptId}`,
    gsi1pk: 'PROMPT#PRIVATE',
    gsi1sk: `${TENANT_ID}#${userId}#${promptId}`
  }),
  sharedPrompt: (promptId: string): KeyAttributes => ({
    pk: join('TENANT'),
    sk: `PROMPT#${promptId}`,
    gsi1pk: 'PROMPT#SHARED',
    gsi1sk: `${TENANT_ID}#${promptId}`
  }),
  userPersona: (userId: string, personaId: string): KeyAttributes => ({
    pk: join('USER', userId),
    sk: `PERSONA#${personaId}`,
    gsi1pk: 'PERSONA#PRIVATE',
    gsi1sk: `${TENANT_ID}#${userId}#${personaId}`
  }),
  sharedPersona: (personaId: string): KeyAttributes => ({
    pk: join('TENANT'),
    sk: `PERSONA#${personaId}`,
    gsi1pk: 'PERSONA#SHARED',
    gsi1sk: `${TENANT_ID}#${personaId}`
  }),
  providerConfig: (provider: string): KeyAttributes => ({
    pk: join('TENANT'),
    sk: `PROVIDER#${provider}`,
    gsi1pk: 'PROVIDER',
    gsi1sk: `${TENANT_ID}#${provider}`
  }),
  quota: (userId: string, provider: string): KeyAttributes => ({
    pk: join('TENANT'),
    sk: `QUOTA#${userId}#${provider}`,
    gsi1pk: 'QUOTA',
    gsi1sk: `${TENANT_ID}#${provider}#${userId}`
  }),
  sessionEvent: (sessionId: string, isoTimestamp: string): KeyAttributes => ({
    pk: join('SESSION', sessionId),
    sk: `EVENT#${isoTimestamp}`,
    gsi1pk: 'SESSION_EVENT',
    gsi1sk: `${TENANT_ID}#${sessionId}#${isoTimestamp}`
  }),
  sessionSummary: (userId: string, sessionId: string): KeyAttributes => ({
    pk: join('USER', userId),
    sk: `SESSION#${sessionId}`,
    gsi1pk: 'SESSION',
    gsi1sk: `${TENANT_ID}#${userId}#${sessionId}`
  }),
  usageMonthly: (yyyymm: string): KeyAttributes => ({
    pk: join('TENANT'),
    sk: `USAGE#${yyyymm}`,
    gsi1pk: 'USAGE',
    gsi1sk: `${TENANT_ID}#${yyyymm}`
  }),
  websocketConnection: (connectionId: string): KeyAttributes => ({
    pk: join('WS'),
    sk: `CONN#${connectionId}`,
    gsi1pk: 'WS_CONNECTION',
    gsi1sk: `${TENANT_ID}#${connectionId}`
  })
};

export type EntityType =
  | 'USER_PROFILE'
  | 'PROMPT'
  | 'PERSONA'
  | 'PROVIDER_CONFIG'
  | 'QUOTA'
  | 'SESSION_EVENT'
  | 'SESSION_SUMMARY'
  | 'USAGE_MONTHLY'
  | 'WS_CONNECTION';

export interface BaseItem extends KeyAttributes {
  entityType: EntityType;
  tenantId: string;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface UserProfileItem extends BaseItem {
  entityType: 'USER_PROFILE';
  userId: string;
  role: 'student' | 'admin';
  email: string;
  cognitoSub?: string;
  displayName: string;
  firstName?: string;
  lastName?: string;
  avatarKey?: string;
  isActive: boolean;
}

export interface PromptItem extends BaseItem {
  entityType: 'PROMPT';
  promptId: string;
  ownerUserId: string;
  scope: 'PRIVATE' | 'SHARED';
  name: string;
  body: string;
  variables: string[];
}

export interface PersonaItem extends BaseItem {
  entityType: 'PERSONA';
  personaId: string;
  ownerUserId: string;
  scope: 'PRIVATE' | 'SHARED';
  name: string;
  description?: string;
  systemPrompt: string;
  guardrails: string[];
}

export interface ProviderConfigItem extends BaseItem {
  entityType: 'PROVIDER_CONFIG';
  provider: string;
  secretId: string;
  label?: string;
  providerType?: string;
  instanceName?: string;
  status: 'active' | 'revoked' | 'pending';
  lastRotatedAt?: string;
}

export interface QuotaItem extends BaseItem {
  entityType: 'QUOTA';
  userId: string;
  provider: string;
  monthlyTokenLimit?: number;
  monthlySpendLimitGBP?: number;
  tokensUsed: number;
  spendGBP: number;
  usageMonth: string;
}

export interface SessionEventItem extends BaseItem {
  entityType: 'SESSION_EVENT';
  sessionId: string;
  eventType: 'message' | 'system' | 'tool';
  messageId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  provider?: string;
  tokensIn?: number;
  tokensOut?: number;
  createdBy: string;
}

export interface SessionSummaryItem extends BaseItem {
  entityType: 'SESSION_SUMMARY';
  sessionId: string;
  ownerUserId: string;
  title?: string;
  lastInteractionAt: string;
  participants: string[];
  providerId: string;
  providerType: string;
  providerInstanceName: string;
  model: string;
  pinned: boolean;
  status: 'active' | 'archived';
  liveConnectionId?: string;
}

export interface UsageMonthlyItem extends BaseItem {
  entityType: 'USAGE_MONTHLY';
  month: string;
  provider: string;
  totalTokens: number;
  totalSpendGBP: number;
  userBreakdown: Record<string, { tokens: number; spendGBP: number }>;
}

export interface WebsocketConnectionItem extends BaseItem {
  entityType: 'WS_CONNECTION';
  connectionId: string;
  userId: string;
  sessionId?: string;
  expiresAt: number;
}

type BaseAttributes<T extends EntityType> = Omit<BaseItem, 'pk' | 'sk' | 'entityType'> & {
  entityType: T;
};

export const baseItem = <T extends EntityType>(entityType: T): BaseAttributes<T> => ({
  tenantId: TENANT_ID,
  entityType,
  createdAt: timestamp(),
  updatedAt: timestamp(),
  version: 1
});

export const touch = <T extends BaseItem>(item: T): T => ({
  ...item,
  updatedAt: timestamp(),
  version: item.version + 1
});
