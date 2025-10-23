export interface ChatModelOption {
  id: string;
  label: string;
  supportsImageGeneration?: boolean | null;
  supportsTTS?: boolean | null;
  supportsTranscription?: boolean | null;
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
  imageUrl?: string;
  imagePrompt?: string;
  imageAspectRatio?: 'portrait' | 'landscape' | 'square';
  imageGenerating?: boolean;  // True while waiting for final image
  partialCount?: number;       // Track which partial (1, 2, 3)
  createdAt: string;
  provider?: string;
  createdBy: string;
  tokensIn?: number;
  tokensOut?: number;
}
