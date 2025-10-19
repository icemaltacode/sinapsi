import { GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';

import { DEFAULT_QUOTAS } from '../config/quotas';
import { docClient } from '../lib/clients';
import { baseItem, keys, type QuotaItem, touch } from '../lib/dynamo';
import { APP_TABLE_NAME } from '../lib/env';

export interface UpsertQuotaInput {
  userId: string;
  provider: string;
  monthlyTokenLimit?: number;
  monthlySpendLimitGBP?: number;
  usageMonth?: string;
  tokensUsed?: number;
  spendGBP?: number;
}

const tableName = APP_TABLE_NAME;

const currentMonth = () => {
  const now = new Date();
  return `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
};

export const getQuota = async (userId: string, provider: string): Promise<QuotaItem | null> => {
  const key = keys.quota(userId, provider);
  const result = await docClient.send(
    new GetCommand({
      TableName: tableName,
      Key: { pk: key.pk, sk: key.sk }
    })
  );

  return (result.Item as QuotaItem | undefined) ?? null;
};

export const upsertQuota = async (input: UpsertQuotaInput): Promise<QuotaItem> => {
  const existing = await getQuota(input.userId, input.provider);
  const nowMonth = currentMonth();

  if (existing) {
    const updated: QuotaItem = {
      ...touch(existing),
      monthlyTokenLimit:
        input.monthlyTokenLimit !== undefined
          ? input.monthlyTokenLimit
          : existing.monthlyTokenLimit,
      monthlySpendLimitGBP:
        input.monthlySpendLimitGBP !== undefined
          ? input.monthlySpendLimitGBP
          : existing.monthlySpendLimitGBP,
      usageMonth: input.usageMonth ?? existing.usageMonth ?? nowMonth,
      tokensUsed: input.tokensUsed ?? existing.tokensUsed,
      spendGBP: input.spendGBP ?? existing.spendGBP
    };

    await docClient.send(
      new PutCommand({
        TableName: tableName,
        Item: updated
      })
    );

    return updated;
  }

  const item: QuotaItem = {
    ...baseItem('QUOTA'),
    ...keys.quota(input.userId, input.provider),
    userId: input.userId,
    provider: input.provider,
    monthlyTokenLimit: input.monthlyTokenLimit,
    monthlySpendLimitGBP: input.monthlySpendLimitGBP,
    usageMonth: input.usageMonth ?? nowMonth,
    tokensUsed: input.tokensUsed ?? 0,
    spendGBP: input.spendGBP ?? 0
  };

  await docClient.send(
    new PutCommand({
      TableName: tableName,
      Item: item
    })
  );

  return item;
};

export const ensureDefaultQuotas = async (userId: string): Promise<void> => {
  await Promise.all(
    DEFAULT_QUOTAS.map(async (quota) => {
      if (!quota.monthlyTokenLimit && !quota.monthlySpendLimitGBP) {
        return;
      }

      const existing = await getQuota(userId, quota.provider);
      if (existing) {
        return;
      }

      await upsertQuota({
        userId,
        provider: quota.provider,
        monthlyTokenLimit: quota.monthlyTokenLimit,
        monthlySpendLimitGBP: quota.monthlySpendLimitGBP
      });
    })
  );
};
