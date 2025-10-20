export interface ChatModelOption {
  id: string;
  label: string;
}

export interface ChatProviderOption {
  providerId: string;
  providerType: string;
  instanceName: string;
  models: ChatModelOption[];
}

export interface ChatSessionSummary {
  sessionId: string;
  ownerUserId: string;
  providerId: string;
  providerType: string;
  providerInstanceName: string;
  model: string;
  title?: string | null;
  lastInteractionAt: string;
  pinned: boolean;
  status: 'active' | 'archived';
  liveConnectionId?: string | null;
}

export interface ChatMessage {
  messageId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  createdAt: string;
  provider?: string;
  createdBy: string;
  tokensIn?: number;
  tokensOut?: number;
}
