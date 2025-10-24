import { apiRequest } from './api';
import type {
  ChatMessage,
  ChatProviderOption,
  ChatSessionSummary
} from '../types/chat';

export const fetchProviders = async (token: string): Promise<ChatProviderOption[]> => {
  const response = await apiRequest<{ items: ChatProviderOption[] }>('/chat/providers', {
    token
  });
  return response.items;
};

export const createSession = async (
  token: string,
  payload: { providerId: string; model: string; connectionId?: string | null }
): Promise<ChatSessionSummary> => {
  const response = await apiRequest<{ session: ChatSessionSummary }>('/chat/sessions', {
    method: 'POST',
    token,
    body: payload
  });
  return response.session;
};

export const listSessions = async (
  token: string
): Promise<{ items: ChatSessionSummary[]; nextCursor?: string }> => {
  return apiRequest<{ items: ChatSessionSummary[]; nextCursor?: string }>('/chat/sessions', {
    token
  });
};

export const getSession = async (
  token: string,
  sessionId: string
): Promise<{ session: ChatSessionSummary; messages: ChatMessage[] }> => {
  return apiRequest<{ session: ChatSessionSummary; messages: ChatMessage[] }>(
    `/chat/sessions/${sessionId}`,
    {
      token
    }
  );
};

export const updateSession = async (
  token: string,
  sessionId: string,
  payload: { pinned?: boolean; title?: string; connectionId?: string | null }
): Promise<ChatSessionSummary> => {
  const response = await apiRequest<{ session: ChatSessionSummary }>(
    `/chat/sessions/${sessionId}`,
    {
      method: 'PATCH',
      token,
      body: payload
    }
  );
  return response.session;
};

export const sendMessage = async (
  token: string,
  sessionId: string,
  payload: {
    message: string;
    connectionId?: string;
    role?: 'user' | 'system';
    attachments?: Array<{
      fileKey: string;
      fileName: string;
      fileType: string;
      fileSize: number;
    }>;
  }
): Promise<{ sessionId: string; userMessageId: string; assistantMessageId?: string }> => {
  return apiRequest<{ sessionId: string; userMessageId: string; assistantMessageId?: string }>(
    `/chat/sessions/${sessionId}/messages`,
    {
      method: 'POST',
      token,
      body: payload
    }
  );
};

export const getPresignedUploadUrl = async (
  token: string,
  sessionId: string,
  file: { fileName: string; fileType: string; fileSize: number }
): Promise<{ uploadUrl: string; fileKey: string; expiresAt: string }> => {
  return apiRequest<{ uploadUrl: string; fileKey: string; expiresAt: string }>(
    `/chat/sessions/${sessionId}/upload/presign`,
    {
      method: 'POST',
      token,
      body: file
    }
  );
};

export const uploadFileToS3 = async (uploadUrl: string, file: File): Promise<void> => {
  const response = await fetch(uploadUrl, {
    method: 'PUT',
    body: file,
    headers: {
      'Content-Type': file.type
    }
  });

  if (!response.ok) {
    throw new Error(`Failed to upload file: ${response.statusText}`);
  }
};

export const deleteSession = async (token: string, sessionId: string): Promise<void> => {
  await apiRequest(`/chat/sessions/${sessionId}`, {
    method: 'DELETE',
    token
  });
};
