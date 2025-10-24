import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react';
import {
  ArrowDown,
  ArrowUp,
  History,
  Loader2,
  MessageCircleMore,
  Paperclip,
  Pin,
  PinOff,
  Plus,
  Send,
  Settings,
  Sparkles,
  Trash2,
  X
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';

import { useAuth } from '../context/auth-context';
import { cn } from '../lib/utils';
import { TokenDebugPanel } from './token-console';
import { ModelSelector } from '../components/ModelSelector';
import { ProviderSelector } from '../components/ProviderSelector';
import {
  createSession,
  deleteSession as deleteSessionRequest,
  fetchProviders,
  getPresignedUploadUrl,
  getSession,
  listSessions,
  sendMessage,
  uploadFileToS3
} from '../lib/chat-api';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../components/ui/dialog';
import type {
  ChatMessage,
  ChatProviderOption,
  ChatSessionSummary
} from '../types/chat';
import { Button } from '../components/ui/button';
import { AnimatedImagePlaceholder } from '../components/AnimatedImagePlaceholder';
import { FileUploadPreview, type PendingFileUpload } from '../components/FileUploadPreview';
import { MessageAttachments } from '../components/MessageAttachments';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '../components/ui/dropdown-menu';
const isFrontendDebugEnabled = (() => {
  const value = import.meta.env.VITE_FRONTEND_DEBUG;
  if (typeof value === 'boolean') {
    return value;
  }
  return String(value ?? '').toLowerCase() === 'true';
})();

interface AssistantStreamState {
  sessionId: string;
  messageId: string;
}

const wsUrl = import.meta.env.VITE_WS_API_URL as string | undefined;

const formatTimestamp = (iso: string) => {
  try {
    const date = new Date(iso);
    return date.toLocaleString();
  } catch {
    return iso;
  }
};

const sortSessions = (sessions: ChatSessionSummary[]) =>
  [...sessions].sort((a, b) => {
    if (a.pinned && !b.pinned) return -1;
    if (!a.pinned && b.pinned) return 1;
    return b.lastInteractionAt.localeCompare(a.lastInteractionAt);
  });

export function HomePage() {
  const { message, user, idToken } = useAuth();
  const greeting = useMemo(
    () => user?.displayName?.split(' ')[0] ?? user?.firstName ?? 'there',
    [user?.displayName, user?.firstName]
  );

  const [providers, setProviders] = useState<ChatProviderOption[]>([]);
  const [sessions, setSessions] = useState<ChatSessionSummary[]>([]);
  const [messagesBySession, setMessagesBySession] = useState<Record<string, ChatMessage[]>>({});
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(null);
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [connectionId, setConnectionId] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyPinned, setHistoryPinned] = useState(false);
  const [showNewChatForm, setShowNewChatForm] = useState(false);
  const [sessionPendingDelete, setSessionPendingDelete] = useState<ChatSessionSummary | null>(null);
  const [composerValue, setComposerValue] = useState('');
  const [sending, setSending] = useState(false);
  const [assistantStream, setAssistantStream] = useState<AssistantStreamState | null>(null);
  const [providersLoading, setProvidersLoading] = useState(false);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [systemPromptOpen, setSystemPromptOpen] = useState(false);
  const [systemPromptValue, setSystemPromptValue] = useState('');
  const [pendingFiles, setPendingFiles] = useState<PendingFileUpload[]>([]);
  const [isDragging, setIsDragging] = useState(false);

  const socketRef = useRef<WebSocket | null>(null);
  const messagesViewportRef = useRef<HTMLDivElement | null>(null);
  const prevSessionIdRef = useRef<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const loadedSessionsRef = useRef(new Set<string>());
  const activePollingIntervalsRef = useRef<Map<string, NodeJS.Timeout>>(new Map());

  const sortedSessions = useMemo(() => sortSessions(sessions), [sessions]);
  const historyVisible = historyPinned || historyOpen;
  const historyOverlay = historyVisible && !historyPinned;

  const updateSessionState = useCallback((next: ChatSessionSummary) => {
    setSessions((prev) => {
      const existingIndex = prev.findIndex((item) => item.sessionId === next.sessionId);
      if (existingIndex === -1) {
        return [...prev, next];
      }
      const copy = [...prev];
      copy[existingIndex] = { ...copy[existingIndex], ...next };
      return copy;
    });
  }, []);

  const updateMessages = useCallback(
    (sessionId: string, updater: (messages: ChatMessage[]) => ChatMessage[]) => {
      setMessagesBySession((prev) => {
        const current = prev[sessionId] ?? [];
        const next = updater(current);
        return { ...prev, [sessionId]: next };
      });
    },
    []
  );

  const ensureActiveSessionLoaded = useCallback(
    async (sessionId: string) => {
      if (!idToken || loadedSessionsRef.current.has(sessionId)) {
        return;
      }

      try {
        const result = await getSession(idToken, sessionId);
        updateSessionState(result.session);
        setMessagesBySession((prev) => ({
          ...prev,
          [sessionId]: result.messages
        }));
        loadedSessionsRef.current.add(sessionId);
      } catch (error) {
        console.error('Failed to load session history', error);
      }
    },
    [idToken, updateSessionState]
  );

  const refreshSessions = useCallback(async () => {
    if (!idToken) return;
    setSessionsLoading(true);
    try {
      const response = await listSessions(idToken);
      setSessions(response.items);
    } catch (error) {
      console.error('Failed to list sessions', error);
    } finally {
      setSessionsLoading(false);
    }
  }, [idToken]);

  const initialiseProviders = useCallback(async () => {
    if (!idToken) return;
    setProvidersLoading(true);
    try {
      const list = await fetchProviders(idToken);
      setProviders(list);
      if (!selectedProviderId && list.length > 0) {
        setSelectedProviderId(list[0].providerId);
        setSelectedModelId(list[0].models[0]?.id ?? null);
      }
    } catch (error) {
      console.error('Failed to fetch providers', error);
    } finally {
      setProvidersLoading(false);
    }
  }, [idToken, selectedProviderId]);

  useEffect(() => {
    if (!idToken) return;
    void initialiseProviders();
    void refreshSessions();
  }, [idToken, initialiseProviders, refreshSessions]);

  useEffect(() => {
    if (!activeSessionId) return;
    void ensureActiveSessionLoaded(activeSessionId);
  }, [activeSessionId, ensureActiveSessionLoaded]);

  useEffect(() => {
    if (!wsUrl || !idToken) {
      return;
    }

    // Prevent double initialization - check if WebSocket already exists and is active
    const existingSocket = socketRef.current;
    if (existingSocket && (existingSocket.readyState === WebSocket.CONNECTING || existingSocket.readyState === WebSocket.OPEN)) {
      return;
    }

    const ws = new WebSocket(wsUrl);
    socketRef.current = ws;

    ws.addEventListener('open', () => {
      ws.send(
        JSON.stringify({
          type: 'register',
          token: idToken
        })
      );
    });

    ws.addEventListener('message', (event) => {
      try {
        const payload = JSON.parse(event.data as string) as Record<string, unknown>;

        if (typeof payload.connectionId === 'string') {
          setConnectionId(payload.connectionId);
          return;
        }

        const type = payload.type as string | undefined;
        if (!type) return;

        if (type === 'assistant.started') {
          const sessionId = payload.sessionId as string;
          const messageId = payload.messageId as string;
          if (!sessionId || !messageId) return;
          setAssistantStream({ sessionId, messageId });
          updateMessages(sessionId, (messages) => [
            ...messages,
            {
              messageId,
              role: 'assistant',
              content: '',
              createdAt: new Date().toISOString(),
              createdBy: 'assistant'
            }
          ]);
          return;
        }

        if (type === 'assistant.delta') {
          const sessionId = payload.sessionId as string;
          const messageId = payload.messageId as string;
          const delta = payload.delta as string;
          if (!sessionId || !messageId || typeof delta !== 'string') return;
          updateMessages(sessionId, (messages) =>
            messages.map((message) =>
              message.messageId === messageId
                ? {
                    ...message,
                    content: `${message.content}${delta}`
                  }
                : message
            )
          );
          return;
        }

        if (type === 'assistant.completed') {
          const sessionId = payload.sessionId as string;
          const messageId = payload.messageId as string;
          const content = payload.content as string;
          if (!sessionId || !messageId) return;
          updateMessages(sessionId, (messages) =>
            messages.map((message) =>
              message.messageId === messageId
                ? {
                    ...message,
                    content: typeof content === 'string' ? content : message.content
                  }
                : message
            )
          );
          setAssistantStream(null);
          void refreshSessions();
          return;
        }

        if (type === 'assistant.error') {
          const sessionId = payload.sessionId as string;
          const errorMessage = (payload.message as string) ?? 'Something went wrong.';
          if (sessionId) {
            updateMessages(sessionId, (messages) => [
              ...messages,
              {
                messageId: `error-${Date.now()}`,
                role: 'system',
                content: errorMessage,
                createdAt: new Date().toISOString(),
                createdBy: 'system'
              }
            ]);
          }
          setAssistantStream(null);
          return;
        }

        if (type === 'session.title') {
          const sessionId = payload.sessionId as string;
          const title = payload.title as string;
          if (sessionId && typeof title === 'string') {
            setSessions((prev) =>
              prev.map((session) =>
                session.sessionId === sessionId ? { ...session, title } : session
              )
            );
          }
          return;
        }

        if (type === 'assistant.image.started') {
          const sessionId = payload.sessionId as string;
          const messageId = payload.messageId as string;
          if (!sessionId || !messageId) return;
          console.log('🎨 Image generation started');
          setAssistantStream({ sessionId, messageId });
          updateMessages(sessionId, (messages) => [
            ...messages,
            {
              messageId,
              role: 'assistant',
              content: 'Generating image...',
              createdAt: new Date().toISOString(),
              createdBy: 'assistant'
            }
          ]);
          return;
        }

        if (type === 'assistant.image.aspect_detected') {
          const sessionId = payload.sessionId as string;
          const messageId = payload.messageId as string;
          const aspectRatio = payload.aspectRatio as 'portrait' | 'landscape' | 'square';
          if (!sessionId || !messageId || !aspectRatio) return;
          console.log(`🎨 Aspect ratio detected: ${aspectRatio}`);

          // Update existing message if it exists, otherwise create it
          updateMessages(sessionId, (messages) => {
            const existingMessage = messages.find(m => m.messageId === messageId);

            if (existingMessage) {
              // Update existing message
              return messages.map((message) =>
                message.messageId === messageId
                  ? {
                      ...message,
                      imageAspectRatio: aspectRatio,
                      imageGenerating: true
                    }
                  : message
              );
            } else {
              // Create new message with aspect ratio
              return [
                ...messages,
                {
                  messageId,
                  role: 'assistant' as const,
                  content: 'Generating image...',
                  imageAspectRatio: aspectRatio,
                  imageGenerating: true,
                  createdAt: new Date().toISOString(),
                  createdBy: 'assistant'
                }
              ];
            }
          });
          return;
        }

        if (type === 'assistant.image.progress') {
          const sessionId = payload.sessionId as string;
          const messageId = payload.messageId as string;
          const progressMessage = payload.message as string;
          if (!sessionId || !messageId) return;
          updateMessages(sessionId, (messages) =>
            messages.map((message) =>
              message.messageId === messageId
                ? {
                    ...message,
                    content: progressMessage || 'Generating image...'
                  }
                : message
            )
          );
          return;
        }

        if (type === 'assistant.image.partial') {
          const sessionId = payload.sessionId as string;
          const messageId = payload.messageId as string;
          const imageUrl = payload.imageUrl as string;
          const partialCount = payload.partialCount as number | undefined;
          if (!sessionId || !messageId || !imageUrl) return;

          console.log(`🎨 Partial ${partialCount}/3 received`);

          // Update message with partial image URL, create if doesn't exist
          updateMessages(sessionId, (messages) => {
            const existingMessage = messages.find(m => m.messageId === messageId);

            if (existingMessage) {
              return messages.map((message) =>
                message.messageId === messageId
                  ? {
                      ...message,
                      content: 'Generating image...',
                      imageUrl,
                      imageGenerating: true,
                      partialCount
                    }
                  : message
              );
            } else {
              return [
                ...messages,
                {
                  messageId,
                  role: 'assistant' as const,
                  content: 'Generating image...',
                  imageUrl,
                  imageGenerating: true,
                  partialCount,
                  createdAt: new Date().toISOString(),
                  createdBy: 'assistant'
                }
              ];
            }
          });
          return;
        }

        if (type === 'assistant.image.completed') {
          const sessionId = payload.sessionId as string;
          const messageId = payload.messageId as string;
          const imageUrl = payload.imageUrl as string;
          const prompt = payload.prompt as string;
          if (!sessionId || !messageId || !imageUrl) return;

          console.log('🎨 Final image received');

          updateMessages(sessionId, (messages) => {
            const existingMessage = messages.find(m => m.messageId === messageId);

            if (existingMessage) {
              return messages.map((message) =>
                message.messageId === messageId
                  ? {
                      ...message,
                      content: `Generated image: ${prompt}`,
                      imageUrl,
                      imagePrompt: prompt,
                      imageGenerating: false
                    }
                  : message
              );
            } else {
              return [
                ...messages,
                {
                  messageId,
                  role: 'assistant' as const,
                  content: `Generated image: ${prompt}`,
                  imageUrl,
                  imagePrompt: prompt,
                  imageGenerating: false,
                  createdAt: new Date().toISOString(),
                  createdBy: 'assistant'
                }
              ];
            }
          });
          setAssistantStream(null);
          void refreshSessions();

          // Stop polling since we got the image via WebSocket
          const existingInterval = activePollingIntervalsRef.current.get(sessionId);
          if (existingInterval) {
            clearInterval(existingInterval);
            activePollingIntervalsRef.current.delete(sessionId);
            console.log('Stopped polling - image received via WebSocket');
          }

          return;
        }
      } catch (error) {
        console.error('Failed to parse websocket message', error);
      }
    });

    const cleanup = () => {
      setConnectionId(null);
      socketRef.current = null;
    };

    ws.addEventListener('close', cleanup);
    ws.addEventListener('error', cleanup);

    return () => {
      ws.removeEventListener('close', cleanup);
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idToken]);

  // Track whether user is near the bottom; only autoscroll when true
  useEffect(() => {
    const viewport = messagesViewportRef.current;
    if (!viewport) return;
    const onScroll = () => {
      const nearBottom =
        viewport.scrollTop >= viewport.scrollHeight - viewport.clientHeight - 40;
      setAutoScroll(nearBottom);
    };
    viewport.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => viewport.removeEventListener('scroll', onScroll);
  }, []);

  // On new messages or session change, scroll if user is at bottom or session switched
  useEffect(() => {
    const viewport = messagesViewportRef.current;
    if (!viewport) return;
    const sessionChanged = prevSessionIdRef.current !== activeSessionId;
    if (autoScroll || sessionChanged) {
      viewport.scrollTo({ top: viewport.scrollHeight, behavior: 'auto' });
    }
    prevSessionIdRef.current = activeSessionId;
  }, [activeSessionId, messagesBySession, autoScroll]);

  const currentProvider = useMemo(
    () => providers.find((provider) => provider.providerId === selectedProviderId) ?? null,
    [providers, selectedProviderId]
  );

  const activeSession = useMemo(
    () => sessions.find((session) => session.sessionId === activeSessionId) ?? null,
    [sessions, activeSessionId]
  );

  const currentMessages = useMemo(
    () => (activeSessionId ? messagesBySession[activeSessionId] ?? [] : []),
    [activeSessionId, messagesBySession]
  );

  const tokenStats = useMemo(() => {
    const stats = { sent: 0, received: 0, total: 0 };
    currentMessages.forEach((msg) => {
      if (msg.tokensIn) stats.sent += msg.tokensIn;
      if (msg.tokensOut) stats.received += msg.tokensOut;
    });
    stats.total = stats.sent + stats.received;
    return stats;
  }, [currentMessages]);

  // Load existing system message when opening the panel
  useEffect(() => {
    if (systemPromptOpen && activeSessionId) {
      const systemMessages = currentMessages.filter((msg) => msg.role === 'system');
      if (systemMessages.length > 0) {
        // Use the most recent system message
        const latestSystemMessage = systemMessages[systemMessages.length - 1];
        setSystemPromptValue(latestSystemMessage.content);
      } else {
        setSystemPromptValue('');
      }
    }
  }, [systemPromptOpen, activeSessionId, currentMessages]);

  const handleSelectSession = useCallback(
    async (sessionId: string) => {
      setActiveSessionId(sessionId);
      setHistoryOpen(historyPinned);
       setShowNewChatForm(false);
      await ensureActiveSessionLoaded(sessionId);
    },
    [ensureActiveSessionLoaded, historyPinned]
  );

  const handleStartSession = useCallback(async () => {
    if (!idToken || !selectedProviderId || !selectedModelId) return;
    setSending(true);
    try {
      const session = await createSession(idToken, {
        providerId: selectedProviderId,
        model: selectedModelId,
        connectionId: connectionId ?? undefined
      });
      updateSessionState(session);
      setActiveSessionId(session.sessionId);
      setMessagesBySession((prev) => ({ ...prev, [session.sessionId]: [] }));
      loadedSessionsRef.current.add(session.sessionId);
      setShowNewChatForm(false);
    } catch (error) {
      console.error('Failed to start session', error);
    } finally {
      setSending(false);
    }
  }, [connectionId, idToken, selectedModelId, selectedProviderId, updateSessionState]);

  // Detect if a message is an image generation request
  const detectImageGenerationIntent = useCallback((message: string): boolean => {
    const lowerMessage = message.toLowerCase();
    const imageTerms = ['image', 'picture', 'photo', 'illustration', 'drawing', 'artwork', 'graphic'];
    const actionTerms = ['generate', 'create', 'make', 'draw', 'produce', 'design', 'show me'];

    const hasImageTerm = imageTerms.some((term) => lowerMessage.includes(term));
    const hasActionTerm = actionTerms.some((term) => lowerMessage.includes(term));

    const patterns = [
      /\b(an?|the)\s+(image|picture|photo|illustration)\s+of\b/i,
      /\bshow\s+me\s+(an?|the|some)\s+(image|picture|photo)\b/i,
      /\b(generate|create|make|draw)\s+.*\s+(image|picture|photo|illustration)\b/i
    ];

    const hasPattern = patterns.some((pattern) => pattern.test(message));
    return (hasImageTerm && hasActionTerm) || hasPattern;
  }, []);

  // Poll for new messages (used when WebSocket might be unreliable)
  const pollForMessages = useCallback(async (sessionId: string, expectedMessageCount: number) => {
    if (!idToken) return;

    // Clear any existing polling for this session
    const existingInterval = activePollingIntervalsRef.current.get(sessionId);
    if (existingInterval) {
      clearInterval(existingInterval);
      activePollingIntervalsRef.current.delete(sessionId);
    }

    const maxPolls = 30; // Poll for up to 5 minutes (30 * 10 seconds)
    let pollCount = 0;

    const pollInterval = setInterval(async () => {
      try {
        pollCount++;
        const sessionData = await getSession(idToken, sessionId);

        if (sessionData.messages.length > expectedMessageCount) {
          // New message(s) found - update the UI
          const currentMessages = messagesBySession[sessionId] || [];
          const newMessages = sessionData.messages.filter(
            msg => !currentMessages.some(existing => existing.messageId === msg.messageId)
          );

          if (newMessages.length > 0) {
            updateMessages(sessionId, (messages) => [...messages, ...newMessages]);
            clearInterval(pollInterval);
            activePollingIntervalsRef.current.delete(sessionId);
          }
        }

        // Stop polling after max attempts
        if (pollCount >= maxPolls) {
          clearInterval(pollInterval);
          activePollingIntervalsRef.current.delete(sessionId);
        }
      } catch (error) {
        console.error('Error polling for messages', error);
        clearInterval(pollInterval);
        activePollingIntervalsRef.current.delete(sessionId);
      }
    }, 10000); // Poll every 10 seconds

    // Store the interval so we can cancel it if WebSocket delivers the result
    activePollingIntervalsRef.current.set(sessionId, pollInterval);

    // Cleanup function
    return () => {
      clearInterval(pollInterval);
      activePollingIntervalsRef.current.delete(sessionId);
    };
  }, [idToken, messagesBySession, updateMessages]);

  const MAX_FILE_SIZE = 30 * 1024 * 1024; // 30MB
  const MAX_FILES = 5;

  const handleFileSelect = useCallback((files: FileList | null) => {
    if (!files || files.length === 0) return;

    const newFiles: PendingFileUpload[] = [];

    for (let i = 0; i < Math.min(files.length, MAX_FILES - pendingFiles.length); i++) {
      const file = files[i];

      // Validate file size
      if (file.size > MAX_FILE_SIZE) {
        alert(`File "${file.name}" exceeds maximum size of 30MB`);
        continue;
      }

      // Create preview URL for images
      let previewUrl: string | undefined;
      if (file.type.startsWith('image/')) {
        previewUrl = URL.createObjectURL(file);
      }

      newFiles.push({
        file,
        uploadProgress: 0,
        previewUrl
      });
    }

    if (pendingFiles.length + newFiles.length > MAX_FILES) {
      alert(`Maximum ${MAX_FILES} files allowed per message`);
    }

    setPendingFiles((prev) => [...prev, ...newFiles]);
  }, [pendingFiles.length]);

  const handleFileUpload = useCallback(async (sessionId: string): Promise<Array<{ fileKey: string; fileName: string; fileType: string; fileSize: number }> | null> => {
    if (!idToken || pendingFiles.length === 0) return [];

    const uploadedFiles: Array<{ fileKey: string; fileName: string; fileType: string; fileSize: number }> = [];

    try {
      for (let i = 0; i < pendingFiles.length; i++) {
        const pendingFile = pendingFiles[i];

        // Update progress to show upload starting
        setPendingFiles((prev) => {
          const updated = [...prev];
          updated[i] = { ...updated[i], uploadProgress: 5 };
          return updated;
        });

        // Get presigned URL
        const { uploadUrl, fileKey } = await getPresignedUploadUrl(idToken, sessionId, {
          fileName: pendingFile.file.name,
          fileType: pendingFile.file.type,
          fileSize: pendingFile.file.size
        });

        // Update with file key
        setPendingFiles((prev) => {
          const updated = [...prev];
          updated[i] = { ...updated[i], fileKey, uploadProgress: 10 };
          return updated;
        });

        // Upload to S3
        await uploadFileToS3(uploadUrl, pendingFile.file);

        // Update progress to complete
        setPendingFiles((prev) => {
          const updated = [...prev];
          updated[i] = { ...updated[i], uploadProgress: 100 };
          return updated;
        });

        uploadedFiles.push({
          fileKey,
          fileName: pendingFile.file.name,
          fileType: pendingFile.file.type,
          fileSize: pendingFile.file.size
        });
      }

      return uploadedFiles;
    } catch (error) {
      console.error('File upload failed', error);
      alert('Failed to upload files. Please try again.');
      return null;
    }
  }, [idToken, pendingFiles]);

  const removeFile = useCallback((index: number) => {
    setPendingFiles((prev) => {
      const updated = [...prev];
      // Clean up preview URL if it exists
      if (updated[index].previewUrl) {
        URL.revokeObjectURL(updated[index].previewUrl!);
      }
      updated.splice(index, 1);
      return updated;
    });
  }, []);

  const handleDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragging(false);

    if (!activeSession) return;

    const files = event.dataTransfer.files;
    handleFileSelect(files);
  }, [activeSession, handleFileSelect]);

  const handleSendMessage = useCallback(async () => {
    if (!idToken || !connectionId || !composerValue.trim()) {
      return;
    }

    let targetSession = activeSession;
    setSending(true);

    try {
      if (!targetSession) {
        if (!selectedProviderId || !selectedModelId) {
          throw new Error('Select a provider and model before starting a chat.');
        }
        const session = await createSession(idToken, {
          providerId: selectedProviderId,
          model: selectedModelId,
          connectionId
        });
        updateSessionState(session);
        setMessagesBySession((prev) => ({ ...prev, [session.sessionId]: [] }));
        loadedSessionsRef.current.add(session.sessionId);
        setActiveSessionId(session.sessionId);
        targetSession = session;
        setShowNewChatForm(false);
      }

      const sessionId = targetSession.sessionId;

      // Upload files if any
      const uploadedFiles = await handleFileUpload(sessionId);
      if (uploadedFiles === null) {
        // Upload failed, don't send message
        return;
      }

      const userMessage: ChatMessage = {
        messageId: `local-${Date.now()}`,
        role: 'user',
        content: composerValue.trim(),
        attachments: uploadedFiles.length > 0 ? uploadedFiles.map(f => ({
          ...f,
          uploadedAt: new Date().toISOString()
        })) : undefined,
        createdAt: new Date().toISOString(),
        createdBy: 'me'
      };
      const messageContent = userMessage.content;
      updateMessages(sessionId, (messages) => [...messages, userMessage]);
      setComposerValue('');
      setPendingFiles([]); // Clear pending files after adding to message

      const isImageRequest = detectImageGenerationIntent(messageContent);

      try {
        await sendMessage(idToken, sessionId, {
          message: messageContent,
          connectionId,
          attachments: uploadedFiles.length > 0 ? uploadedFiles : undefined
        });
      } catch (error) {
        // For image generation requests, a 503 timeout is expected (>30s generation time)
        // The image will be delivered via WebSocket or polling, so we can ignore this error
        if (isImageRequest && error instanceof Error && error.message.includes('503')) {
          console.log('Image generation request timed out (expected), waiting for WebSocket/polling delivery');
        } else {
          // For non-image requests or other errors, re-throw
          throw error;
        }
      }

      // If this is an image generation request, start polling as backup
      // (in case WebSocket disconnects during the long generation time)
      if (isImageRequest) {
        const currentMessageCount = (messagesBySession[sessionId] || []).length + 1; // +1 for user message
        pollForMessages(sessionId, currentMessageCount);
      }
    } catch (error) {
      console.error('Failed to send message', error);
    } finally {
      setSending(false);
    }
  }, [
    activeSession,
    connectionId,
    composerValue,
    detectImageGenerationIntent,
    handleFileUpload,
    idToken,
    messagesBySession,
    pollForMessages,
    selectedModelId,
    selectedProviderId,
    updateMessages,
    updateSessionState
  ]);


  const handleDeleteSession = useCallback(async () => {
      if (!idToken || !sessionPendingDelete) return;
      try {
        await deleteSessionRequest(idToken, sessionPendingDelete.sessionId);
        setSessions((prev) => prev.filter((item) => item.sessionId !== sessionPendingDelete.sessionId));
        setMessagesBySession((prev) => {
          const next = { ...prev };
          delete next[sessionPendingDelete.sessionId];
          return next;
        });
        loadedSessionsRef.current.delete(sessionPendingDelete.sessionId);

        if (activeSessionId === sessionPendingDelete.sessionId) {
          setActiveSessionId(null);
          setComposerValue('');
          setAssistantStream(null);
          setShowNewChatForm(false);
        }
        setHistoryOpen((prev) => (prev && !historyPinned ? false : prev));
        setSessionPendingDelete(null);
      } catch (error) {
        console.error('Failed to delete session', error);
      }
    }, [activeSessionId, historyPinned, idToken, sessionPendingDelete]);

  const renderMessage = (message: ChatMessage) => {
    const isUser = message.role === 'user';
    const isAssistant = message.role === 'assistant';

    return (
      <div
        key={message.messageId}
        className={cn('flex flex-col gap-1 rounded-2xl border px-4 py-3 shadow-sm', {
          'ml-auto max-w-xl border-transparent bg-[#EC5763] text-white': isUser,
          'mr-auto max-w-xl border-border/40 bg-white text-slate-900 dark:bg-card/80 dark:text-foreground': isAssistant,
          'mx-auto max-w-xl border-dashed border-border/60 bg-background/70 text-muted-foreground': !isUser && !isAssistant
        })}
      >
        <div className='flex items-center justify-between gap-3'>
          <div className={cn(
            'flex items-center gap-2 text-xs uppercase tracking-wide',
            isUser ? 'text-white/70' : 'text-muted-foreground/80'
          )}>
            {isUser ? 'You' : isAssistant ? 'Assistant' : 'System'}
          </div>
          <span className={cn(
            'text-[0.65rem]',
            isUser ? 'text-white/60' : 'text-muted-foreground'
          )}>
            {formatTimestamp(message.createdAt)}
          </span>
        </div>
        <div className={cn(
          'prose prose-sm max-w-none text-sm leading-relaxed',
          'prose-headings:mt-3 prose-headings:mb-2',
          'prose-p:my-2 prose-pre:my-2 prose-ul:my-2 prose-ol:my-2 prose-li:my-0',
          isAssistant && 'prose-invert dark:prose-invert'
        )}>
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            rehypePlugins={[rehypeHighlight]}
            components={{
              pre: ({ children }) => (
                <pre className='overflow-x-auto rounded-lg bg-slate-900 p-3 text-xs text-slate-100 dark:bg-slate-950 dark:text-slate-200'>
                  {children}
                </pre>
              ),
              code: ({ className, children, ...props }) => {
                const isInline = !className;
                return isInline ? (
                  <code className='rounded bg-slate-200 px-1.5 py-0.5 text-xs font-mono text-slate-900 dark:bg-slate-700 dark:text-slate-100' {...props}>
                    {children}
                  </code>
                ) : (
                  <code className={className} {...props}>
                    {children}
                  </code>
                );
              },
              a: ({ children, ...props }) => (
                <a className='text-primary hover:underline' {...props}>
                  {children}
                </a>
              ),
              blockquote: ({ children }) => (
                <blockquote className='border-l-4 border-primary/50 pl-4 italic text-muted-foreground'>
                  {children}
                </blockquote>
              )
            }}
          >
            {message.content}
          </ReactMarkdown>
          {/* File attachments */}
          {message.attachments && message.attachments.length > 0 && (
            <div className='mt-3'>
              <MessageAttachments attachments={message.attachments} />
            </div>
          )}
          {/* Image generation states */}
          {message.imageGenerating && message.imageAspectRatio && !message.imageUrl && (
            <div className='mt-3'>
              <AnimatedImagePlaceholder aspectRatio={message.imageAspectRatio} />
            </div>
          )}
          {message.imageUrl && (
            <div className='mt-3 relative'>
              <div className='overflow-hidden rounded-lg border border-border/30'>
                <img
                  src={message.imageUrl}
                  alt={message.imagePrompt || 'Generated image'}
                  className='h-auto max-w-full'
                  loading='lazy'
                />
              </div>
              {/* Show shimmer overlay while generating (for partials) */}
              {message.imageGenerating && (
                <div className='absolute inset-0 rounded-lg overflow-hidden pointer-events-none'>
                  <div className='absolute inset-0 bg-gradient-to-r from-transparent via-white/30 to-transparent animate-shimmer-overlay' />
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    );
  };

  const renderHistoryList = (onSelect?: () => void) => {
    if (sessionsLoading) {
      return (
        <div className='flex items-center gap-2 text-sm text-muted-foreground'>
          <Loader2 className='h-4 w-4 animate-spin' /> Loading history…
        </div>
      );
    }

    if (sortedSessions.length === 0) {
      return <p className='text-sm text-muted-foreground'>No previous conversations yet.</p>;
    }

    return sortedSessions.map((session) => {
      const isActive = session.sessionId === activeSessionId;
      return (
        <div
          key={session.sessionId}
          className={cn(
            'flex items-center gap-2 rounded-xl border border-transparent px-3 py-3 transition hover:border-border/40 hover:bg-background/60',
            isActive && 'border-primary/60 bg-primary/10'
          )}
        >
          <button
            type='button'
            onClick={() => {
              void handleSelectSession(session.sessionId);
              onSelect?.();
            }}
            className='flex flex-1 items-start gap-2 text-left'
          >
            {session.pinned ? (
              <span className='inline-flex h-7 w-7 items-center justify-center rounded-full border border-border/40 bg-background/70 text-primary'>
                <Pin className='h-4 w-4' />
              </span>
            ) : null}
            <div className='flex-1'>
              <p className='text-sm font-semibold leading-snug text-foreground break-words whitespace-normal'>
                {session.title || 'Untitled conversation'}
              </p>
              <p className='text-xs text-muted-foreground'>
                {session.providerInstanceName} • {session.model}
              </p>
              <p className='mt-2 text-[0.7rem] text-muted-foreground/80'>
                Last active {formatTimestamp(session.lastInteractionAt)}
              </p>
            </div>
          </button>
            <Button
              type='button'
              size='icon'
              variant='ghost'
              className='ml-2 h-8 w-8 rounded-full border border-border/40 text-muted-foreground transition hover:text-destructive'
              onClick={() => setSessionPendingDelete(session)}
              aria-label='Delete conversation'
            >
              <Trash2 className='h-4 w-4' />
            </Button>
        </div>
      );
    });
  };

  return (
    <>
      {message ? (
        <div
          className={cn(
            'rounded-xl border px-4 py-3 text-sm',
            message.type === 'error'
              ? 'border-destructive/50 bg-destructive/10 text-destructive'
              : 'border-emerald-500/50 bg-emerald-500/10 text-emerald-200'
          )}
        >
          {message.text}
        </div>
      ) : null}

      <section
        id='chat-workspace'
        className='relative flex w-full flex-1 min-h-0 flex-col gap-6 overflow-hidden rounded-2xl border border-border/40 bg-card/70 p-3 md:p-6 shadow-xl backdrop-blur'
      >
        {historyOverlay ? (
          <div
            id='history-overlay-panel'
            className='absolute inset-y-6 left-6 z-30 flex w-72 flex-col rounded-2xl border border-border/30 bg-background/95 p-4 shadow-xl'
          >
            <div className='mb-4 flex flex-shrink-0 items-center justify-between'>
              <h3 className='text-sm font-semibold text-foreground'>Conversation history</h3>
              <div className='flex items-center gap-1'>
                <Button
                  type='button'
                  size='icon'
                  variant='ghost'
                  className='h-8 w-8 rounded-full border border-border/40'
                  onClick={() => {
                    setHistoryPinned(true);
                    setHistoryOpen(true);
                  }}
                  aria-label='Pin history'
                >
                  <Pin className='h-4 w-4' />
                </Button>
                <Button
                  type='button'
                  size='icon'
                  variant='ghost'
                  className='h-8 w-8 rounded-full border border-border/40'
                  onClick={() => setHistoryOpen(false)}
                  aria-label='Close history'
                >
                  <X className='h-4 w-4' />
                </Button>
              </div>
            </div>
            <div className='flex-1 space-y-3 overflow-y-auto pr-1'>{renderHistoryList(() => setHistoryOpen(false))}</div>
            <p className='mt-4 flex-shrink-0 text-[0.7rem] text-muted-foreground/80'>
              Conversations auto-save once you send the first message. Pin important threads to keep them handy.
            </p>
          </div>
        ) : null}

        <div
          id='chat-toolbar'
          className='relative flex flex-shrink-0 flex-col gap-4 md:flex-row md:items-center md:justify-between'
        >
          {/* History toggle button - floating at top left (hide when pinned) */}
          {!historyPinned && (
            <button
              type='button'
              className='absolute -left-3 -top-3 z-40 flex h-10 w-10 items-center justify-center rounded-full border border-border/40 bg-background/90 text-muted-foreground shadow-lg transition hover:bg-background hover:text-foreground'
              onClick={() => setHistoryOpen((value) => !value)}
              aria-label='Toggle conversation history'
            >
              <History className='h-5 w-5' />
            </button>
          )}

          <div className='pl-8 md:pl-8'>
            <h2 className='flex items-center gap-2 text-2xl font-semibold tracking-tight text-white'>
              <MessageCircleMore className='h-5 w-5 text-primary/80' /> Chat workspace
            </h2>
            <p className='text-sm text-muted-foreground'>
              Welcome back, {greeting}. Start a new conversation or pick up where you left off.
            </p>
          </div>

          <div className='flex flex-shrink-0 flex-wrap items-center gap-3'>
            <Button
              type='button'
              className='min-w-[8rem] bg-[#EC5763] text-white shadow-md transition hover:bg-[#f47180]'
              size='sm'
              disabled={sending || providersLoading}
              onClick={() => {
                setShowNewChatForm((value) => !value);
                if (!historyPinned) {
                  setHistoryOpen(false);
                }
              }}
            >
              <Sparkles className='mr-2 h-4 w-4' />
              {showNewChatForm ? 'Close' : 'New chat'}
            </Button>
          </div>
        </div>

        {showNewChatForm ? (
          <div id='new-chat-form' className='grid flex-shrink-0 gap-4 md:grid-cols-2'>
            <div className='flex flex-col gap-2'>
              <label htmlFor='provider' className='text-xs font-semibold uppercase tracking-wide text-muted-foreground'>
                Provider instance
              </label>
              {providersLoading ? (
                <div className='flex h-11 items-center rounded-lg border border-border/50 bg-background/80 px-3 text-sm text-muted-foreground'>
                  Loading providers...
                </div>
              ) : providers.length === 0 ? (
                <div className='flex h-11 items-center rounded-lg border border-border/50 bg-background/80 px-3 text-sm text-muted-foreground'>
                  No providers available
                </div>
              ) : (
                <ProviderSelector
                  providers={providers}
                  selectedProviderId={selectedProviderId}
                  onProviderChange={(providerId) => {
                    const nextProvider = providers.find((provider) => provider.providerId === providerId);
                    setSelectedProviderId(providerId);
                    setSelectedModelId(nextProvider?.models[0]?.id ?? null);
                  }}
                />
              )}
            </div>

            <div className='flex flex-col gap-2'>
              <label htmlFor='model' className='text-xs font-semibold uppercase tracking-wide text-muted-foreground'>
                Model
              </label>
              {!currentProvider ? (
                <div className='flex h-11 items-center rounded-lg border border-border/50 bg-background/80 px-3 text-sm text-muted-foreground'>
                  Select a provider first
                </div>
              ) : (
                <ModelSelector
                  models={currentProvider.models}
                  selectedModelId={selectedModelId}
                  onModelChange={(modelId) => setSelectedModelId(modelId)}
                />
              )}
            </div>

            <div className='md:col-span-2 flex items-center justify-end'>
              <Button
                type='button'
                className='min-w-[7rem] bg-[#EC5763] text-white shadow-md transition hover:bg-[#f47180]'
                onClick={handleStartSession}
                disabled={sending || !selectedProviderId || !selectedModelId}
              >
                {sending ? <Loader2 className='mr-2 h-4 w-4 animate-spin' /> : <Sparkles className='mr-2 h-4 w-4' />}
                Start chat
              </Button>
            </div>
          </div>
        ) : null}

        <div
          id='chat-layout'
          className='flex w-full flex-1 min-h-0 flex-col gap-4 overflow-hidden md:flex-row'
        >
          {historyPinned ? (
            <div
              id='history-sidebar'
              className='hidden min-h-0 w-full max-w-[18rem] flex-shrink-0 flex-col rounded-2xl border border-border/30 bg-background/40 p-4 md:flex'
            >
              <div className='mb-4 flex items-center justify-between'>
                <h3 className='text-sm font-semibold text-foreground'>Conversation history</h3>
                <Button
                  type='button'
                  size='icon'
                  variant='ghost'
                  className='h-8 w-8 rounded-full border border-border/40'
                  onClick={() => setHistoryPinned(false)}
                  aria-label='Unpin history'
                >
                  <PinOff className='h-4 w-4' />
                </Button>
              </div>
              <div className='flex-1 space-y-3 overflow-y-auto pr-1'>{renderHistoryList(() => setHistoryOpen(false))}</div>
              <p className='mt-4 text-[0.7rem] text-muted-foreground/80'>
                Conversations auto-save once you send the first message. Pin important threads to keep them handy.
              </p>
            </div>
          ) : null}

          <div
            id='chat-panel-container'
            className='relative flex min-h-0 w-full flex-1 overflow-hidden'
          >
            <div
              id='chat-panel'
              className='relative flex h-full w-full flex-col rounded-2xl border border-border/40 bg-background/40'
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
            >
              {/* Drag overlay */}
              {isDragging && (
                <div className='absolute inset-0 z-50 flex items-center justify-center rounded-2xl border-4 border-dashed border-primary bg-background/90 backdrop-blur-sm'>
                  <div className='flex flex-col items-center gap-3'>
                    <Paperclip className='h-12 w-12 text-primary' />
                    <p className='text-lg font-semibold text-foreground'>Drop files here</p>
                    <p className='text-sm text-muted-foreground'>Up to 5 files, 30MB each</p>
                  </div>
                </div>
              )}
              {/* Header - fixed at top */}
              <div
                id='chat-panel-header'
                className='flex flex-shrink-0 items-center justify-between gap-3 border-b border-border/30 p-4 text-sm text-muted-foreground'
              >
                {activeSession ? (
                  <>
                    <div>
                      <p className='font-medium text-foreground'>
                        {activeSession.title || 'Untitled conversation'}
                      </p>
                      <p className='text-xs uppercase tracking-wide'>
                        {activeSession.providerInstanceName} • {activeSession.model}
                      </p>
                    </div>
                    <div className='flex items-center gap-3'>
                      <div className='text-right text-xs uppercase tracking-wide text-muted-foreground/80'>
                        {tokenStats.total > 0 ? (
                          <>
                            <div>{tokenStats.total.toLocaleString()} tokens</div>
                            <div className='flex items-center justify-end gap-2 text-[0.65rem] normal-case'>
                              <span className='flex items-center gap-1 group relative'>
                                <ArrowUp className='h-3 w-3' />
                                {tokenStats.sent.toLocaleString()}
                                <span className='absolute bottom-full mb-1 hidden group-hover:block whitespace-nowrap rounded bg-black/90 px-2 py-1 text-[0.65rem] text-white'>
                                  Sent
                                </span>
                              </span>
                              <span className='flex items-center gap-1 group relative'>
                                <ArrowDown className='h-3 w-3' />
                                {tokenStats.received.toLocaleString()}
                                <span className='absolute bottom-full mb-1 hidden group-hover:block whitespace-nowrap rounded bg-black/90 px-2 py-1 text-[0.65rem] text-white'>
                                  Received
                                </span>
                              </span>
                            </div>
                          </>
                        ) : (
                          <div>{currentMessages.length} messages</div>
                        )}
                      </div>
                      <Button
                        type='button'
                        size='icon'
                        variant='ghost'
                        className='h-8 w-8 rounded-full border border-border/40 text-muted-foreground transition hover:text-foreground'
                        onClick={() => setSystemPromptOpen((value) => !value)}
                        aria-label='System prompt'
                      >
                        <Settings className='h-4 w-4' />
                      </Button>
                    </div>
                  </>
                ) : null}
              </div>

              {/* Messages and System Prompt - scrollable middle section */}
              <div className='flex flex-1 min-h-0 overflow-hidden'>
                {/* Messages panel */}
                <div
                  id='chat-messages'
                  ref={messagesViewportRef}
                  className={cn(
                    'flex-1 overflow-y-auto overflow-x-hidden p-4 transition-all',
                    systemPromptOpen && 'hidden md:block md:flex-1'
                  )}
                >
                  <div className='flex flex-col gap-3'>
                    {activeSession ? (
                      currentMessages.length > 0 ? (
                        currentMessages.map(renderMessage)
                      ) : (
                        <div className='flex h-full flex-col items-center justify-center gap-2 text-sm text-muted-foreground'>
                          <Sparkles className='h-5 w-5 text-[#EC5763]' />
                          <p>Ready to chat!</p>
                          <p className='text-xs text-muted-foreground/80'>
                            Type your message below to begin the conversation.
                          </p>
                        </div>
                      )
                    ) : (
                      <div className='flex h-full flex-col items-center justify-center gap-2 text-sm text-muted-foreground'>
                        <MessageCircleMore className='h-8 w-8 text-muted-foreground/50' />
                        <p>No conversation selected.</p>
                        <p className='text-xs text-muted-foreground/80'>
                          Choose a previous chat or click "New chat" to begin.
                        </p>
                      </div>
                    )}
                    {assistantStream && assistantStream.sessionId === activeSessionId ? (
                      <div className='flex items-center gap-2 text-sm text-muted-foreground'>
                        <Loader2 className='h-4 w-4 animate-spin text-primary/80' />
                        <span>Assistant is thinking…</span>
                      </div>
                    ) : null}
                  </div>
                </div>

                {/* System prompt panel */}
                {systemPromptOpen && (
                  <div
                    id='system-prompt-panel'
                    className={cn(
                      'flex flex-col border-l border-border/30 bg-background/60 p-4',
                      'w-full md:w-96 md:flex-shrink-0'
                    )}
                  >
                    <div className='mb-4 flex items-center justify-between'>
                      <h3 className='text-sm font-semibold text-foreground'>System Instructions</h3>
                      <Button
                        type='button'
                        size='icon'
                        variant='ghost'
                        className='h-8 w-8 rounded-full border border-border/40'
                        onClick={() => setSystemPromptOpen(false)}
                        aria-label='Close system prompt'
                      >
                        <X className='h-4 w-4' />
                      </Button>
                    </div>
                    <p className='mb-4 text-xs text-muted-foreground'>
                      Add system-level instructions to guide the assistant's behavior for this conversation.
                    </p>
                    <textarea
                      rows={8}
                      value={systemPromptValue}
                      onChange={(event) => setSystemPromptValue(event.target.value)}
                      placeholder='Enter system instructions here…'
                      className='mb-4 flex-1 resize-none rounded-lg border border-border/30 bg-background/60 px-3 py-2 text-sm text-foreground shadow-inner focus-visible:outline-none focus-visible:ring focus-visible:ring-ring'
                    />
                    <Button
                      type='button'
                      className='bg-[#EC5763] text-white shadow-md transition hover:bg-[#f47180]'
                      onClick={async () => {
                        if (!idToken || !activeSession || !systemPromptValue.trim()) return;

                        const systemMessage: ChatMessage = {
                          messageId: `local-system-${Date.now()}`,
                          role: 'system',
                          content: systemPromptValue.trim(),
                          createdAt: new Date().toISOString(),
                          createdBy: 'user'
                        };

                        updateMessages(activeSession.sessionId, (messages) => [...messages, systemMessage]);

                        try {
                          await sendMessage(idToken, activeSession.sessionId, {
                            message: systemPromptValue.trim(),
                            role: 'system'
                          });
                          setSystemPromptValue('');
                          setSystemPromptOpen(false);
                        } catch (error) {
                          console.error('Failed to send system message', error);
                        }
                      }}
                      disabled={!systemPromptValue.trim() || !activeSession}
                    >
                      <Send className='mr-2 h-4 w-4' />
                      Add System Message
                    </Button>
                  </div>
                )}
              </div>

              {/* Composer - fixed at bottom */}
              <div
                id='chat-composer'
                className='flex flex-shrink-0 flex-col gap-2 border-t border-border/30 bg-background/70 p-4'
              >
                {/* File preview */}
                {pendingFiles.length > 0 && (
                  <FileUploadPreview
                    files={pendingFiles}
                    onRemove={removeFile}
                  />
                )}

                {/* Input row */}
                <div className='flex items-end gap-2'>
                  {/* Plus button with dropdown */}
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        type='button'
                        size='icon'
                        variant='ghost'
                        className='h-10 w-10 flex-shrink-0 rounded-full border border-border/40'
                        disabled={!activeSession || sending}
                        aria-label='More options'
                      >
                        <Plus className='h-5 w-5' />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align='start'>
                      <DropdownMenuItem
                        onClick={() => fileInputRef.current?.click()}
                        disabled={pendingFiles.length >= MAX_FILES}
                      >
                        <Paperclip className='mr-2 h-4 w-4' />
                        Upload file
                        {pendingFiles.length >= MAX_FILES && ' (Max reached)'}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>

                  {/* Hidden file input */}
                  <input
                    ref={fileInputRef}
                    type='file'
                    multiple
                    accept='*/*'
                    onChange={(e) => handleFileSelect(e.target.files)}
                    className='hidden'
                  />

                  <textarea
                    rows={2}
                    value={composerValue}
                    onChange={(event) => setComposerValue(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && !event.shiftKey) {
                        event.preventDefault();
                        void handleSendMessage();
                      }
                    }}
                    placeholder={
                      activeSession
                        ? 'Type your message… (Enter to send, Shift+Enter for new line)'
                        : 'Start a new chat or select a conversation to begin messaging.'
                    }
                    className='flex-1 resize-none rounded-lg border border-border/30 bg-background/60 px-3 py-2 text-sm text-foreground shadow-inner focus-visible:outline-none focus-visible:ring focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50'
                    disabled={!activeSession || sending}
                  />
                  <Button
                    type='button'
                    size='icon'
                    className='h-16 w-16 flex-shrink-0 bg-[#EC5763] text-white shadow-md transition hover:bg-[#f47180]'
                    onClick={handleSendMessage}
                    disabled={!activeSession || sending || !composerValue.trim() || !connectionId || (pendingFiles.length > 0 && pendingFiles.some(f => f.uploadProgress < 100 && f.uploadProgress > 0))}
                    aria-label='Send message'
                  >
                    {sending ? <Loader2 className='h-5 w-5 animate-spin' /> : <Send className='h-5 w-5' />}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {isFrontendDebugEnabled ? <TokenDebugPanel /> : null}

      <Dialog
        open={sessionPendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) {
            setSessionPendingDelete(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete conversation</DialogTitle>
            <DialogDescription>
              This will permanently remove the conversation and its messages. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type='button'
              variant='ghost'
              onClick={() => setSessionPendingDelete(null)}
            >
              Cancel
            </Button>
            <Button
              type='button'
              variant='destructive'
              onClick={() => void handleDeleteSession()}
              disabled={!sessionPendingDelete}
            >
              Delete conversation
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
