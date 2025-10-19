import {
  DEFAULT_OPENAI_MONTHLY_SPEND_GBP,
  DEFAULT_OPENAI_MONTHLY_TOKENS
} from '../lib/env';

export interface DefaultQuota {
  provider: string;
  monthlyTokenLimit?: number;
  monthlySpendLimitGBP?: number;
}

export const DEFAULT_QUOTAS: DefaultQuota[] = [
  {
    provider: 'openai',
    monthlyTokenLimit:
      Number.isFinite(DEFAULT_OPENAI_MONTHLY_TOKENS) && DEFAULT_OPENAI_MONTHLY_TOKENS > 0
        ? DEFAULT_OPENAI_MONTHLY_TOKENS
        : undefined,
    monthlySpendLimitGBP:
      Number.isFinite(DEFAULT_OPENAI_MONTHLY_SPEND_GBP) && DEFAULT_OPENAI_MONTHLY_SPEND_GBP > 0
        ? DEFAULT_OPENAI_MONTHLY_SPEND_GBP
        : undefined
  }
];
