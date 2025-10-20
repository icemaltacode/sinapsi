import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react';
import {
  History,
  Loader2,
  MessageCircleMore,
  Pin,
  PinOff,
  Send,
  Sparkles,
  Trash2,
  X
} from 'lucide-react';

import { useAuth } from '../context/auth-context';
import { cn } from '../lib/utils';
import { TokenDebugPanel } from './token-console';
import {
  createSession,
  deleteSession as deleteSessionRequest,
  fetchProviders,
  getSession,
  listSessions,
  sendMessage,
  updateSession
} from '../lib/chat-api';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '../components/ui/dialog';
import type {
  ChatMessage,
  ChatProviderOption,
  ChatSessionSummary
} from '../types/chat';
import { Button } from '../components/ui/button';
const isFrontendDebugEnabled = (() => {
  const value = import.meta.env.VITE_FRONTEND_DEBUG;
  if (typeof value === 'boolean') {
    return value;
  }
  return String(value ?? '').toLowerCase() === 'true';
})();

type SocketStatus = 'connecting' | 'open' | 'closed' | 'error';

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
  const [socketStatus, setSocketStatus] = useState<SocketStatus>('connecting');
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

  const socketRef = useRef<WebSocket | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const loadedSessionsRef = useRef(new Set<string>());

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
      setSocketStatus('closed');
      return;
    }

    const ws = new WebSocket(wsUrl);
    socketRef.current = ws;
    setSocketStatus('connecting');

    ws.addEventListener('open', () => {
      setSocketStatus('open');
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
      } catch (error) {
        console.error('Failed to parse websocket message', error);
      }
    });

    const cleanup = () => {
      setSocketStatus('closed');
      setConnectionId(null);
      socketRef.current = null;
    };

    ws.addEventListener('close', cleanup);
    ws.addEventListener('error', () => {
      setSocketStatus('error');
    });

    return () => {
      ws.removeEventListener('close', cleanup);
      ws.close();
    };
  }, [idToken, refreshSessions, updateMessages]);

  useEffect(() => {
    const container = messagesEndRef.current;
    if (container) {
      container.scrollIntoView({ behavior: 'smooth' });
    }
  }, [activeSessionId, messagesBySession]);

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
      const userMessage: ChatMessage = {
        messageId: `local-${Date.now()}`,
        role: 'user',
        content: composerValue.trim(),
        createdAt: new Date().toISOString(),
        createdBy: 'me'
      };
      updateMessages(sessionId, (messages) => [...messages, userMessage]);
      setComposerValue('');

      await sendMessage(idToken, sessionId, {
        message: userMessage.content,
        connectionId
      });
    } catch (error) {
      console.error('Failed to send message', error);
    } finally {
      setSending(false);
    }
  }, [
    activeSession,
    connectionId,
    composerValue,
    idToken,
    selectedModelId,
    selectedProviderId,
    updateMessages,
    updateSessionState
  ]);

  const handleTogglePin = useCallback(
    async (session: ChatSessionSummary) => {
      if (!idToken) return;
      try {
        const updated = await updateSession(idToken, session.sessionId, {
          pinned: !session.pinned
        });
        updateSessionState(updated);
      } catch (error) {
        console.error('Failed to toggle pin', error);
      }
    },
    [idToken, updateSessionState]
  );

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
          <div className='flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground/80'>
            {isUser ? 'You' : isAssistant ? 'Assistant' : 'System'}
          </div>
          <span className='text-[0.65rem] text-muted-foreground'>{formatTimestamp(message.createdAt)}</span>
        </div>
        <p className='whitespace-pre-wrap text-sm leading-relaxed'>{message.content}</p>
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
    <div className='space-y-6'>
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

      <section className='relative overflow-hidden rounded-2xl border border-border/40 bg-card/70 p-6 shadow-xl backdrop-blur'>
        {historyOverlay ? (
          <div className='absolute inset-y-6 left-6 z-30 w-72 rounded-2xl border border-border/30 bg-background/95 p-4 shadow-xl'>
            <div className='mb-4 flex items-center justify-between'>
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
            <div className='space-y-3 overflow-y-auto pr-1'>{renderHistoryList(() => setHistoryOpen(false))}</div>
            <p className='mt-4 text-[0.7rem] text-muted-foreground/80'>
              Conversations auto-save once you send the first message. Pin important threads to keep them handy.
            </p>
          </div>
        ) : null}

        <div className='flex flex-col gap-4 md:flex-row md:items-center md:justify-between'>
          <div>
            <h2 className='flex items-center gap-2 text-2xl font-semibold tracking-tight text-white'>
              <MessageCircleMore className='h-5 w-5 text-primary/80' /> Chat workspace
            </h2>
            <p className='text-sm text-muted-foreground'>
              Welcome back, {greeting}. Start a new conversation or pick up where you left off.
            </p>
          </div>

          <div className='flex flex-wrap items-center gap-3'>
            <div className='flex items-center gap-2 rounded-lg border border-border/40 bg-background/70 px-3 py-2 text-sm text-muted-foreground'>
              <span className='font-medium text-foreground/80'>Connection</span>
              <span
                className={cn('inline-flex h-2.5 w-2.5 rounded-full', {
                  'bg-emerald-400': socketStatus === 'open' && connectionId,
                  'bg-yellow-400': socketStatus === 'connecting' || !connectionId,
                  'bg-rose-500': socketStatus === 'error'
                })}
              />
              <span className='text-xs uppercase tracking-wide'>{socketStatus}</span>
            </div>

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
            <Button
              type='button'
              variant='ghost'
              size='icon'
              className='md:hidden'
              onClick={() => setHistoryOpen(true)}
              aria-label='Open history'
            >
              <History className='h-4 w-4' />
            </Button>
          </div>
        </div>

        {showNewChatForm ? (
          <div className='mt-6 grid gap-4 md:grid-cols-2'>
            <div className='flex flex-col gap-2'>
              <label htmlFor='provider' className='text-xs font-semibold uppercase tracking-wide text-muted-foreground'>
                Provider instance
              </label>
              <select
                id='provider'
                className='h-11 rounded-lg border border-border/50 bg-background/80 px-3 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring focus-visible:ring-ring'
                value={selectedProviderId ?? ''}
                onChange={(event) => {
                  const nextProvider = providers.find((provider) => provider.providerId === event.target.value);
                  setSelectedProviderId(event.target.value || null);
                  setSelectedModelId(nextProvider?.models[0]?.id ?? null);
                }}
              >
                {providersLoading ? <option>Loading providers...</option> : null}
                {!providersLoading && providers.length === 0 ? <option value=''>No providers available</option> : null}
                {providers.map((provider) => (
                  <option key={provider.providerId} value={provider.providerId}>
                    {provider.instanceName} ({provider.providerType.toUpperCase()})
                  </option>
                ))}
              </select>
            </div>

            <div className='flex flex-col gap-2'>
              <label htmlFor='model' className='text-xs font-semibold uppercase tracking-wide text-muted-foreground'>
                Model
              </label>
              <select
                id='model'
                className='h-11 rounded-lg border border-border/50 bg-background/80 px-3 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring focus-visible:ring-ring'
                value={selectedModelId ?? ''}
                onChange={(event) => setSelectedModelId(event.target.value || null)}
                disabled={!currentProvider}
              >
                {currentProvider ? (
                  currentProvider.models.map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.label}
                    </option>
                  ))
                ) : (
                  <option value=''>Select a provider first</option>
                )}
              </select>
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

        <div className={cn('mt-6 flex flex-col gap-4 md:flex-row', historyPinned ? 'md:items-start md:gap-6' : 'md:items-start')}>
          {historyPinned ? (
            <div className='hidden w-full max-w-[18rem] flex-col rounded-2xl border border-border/30 bg-background/40 p-4 md:flex'>
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
              <div className='space-y-3 overflow-y-auto pr-1'>{renderHistoryList(() => setHistoryOpen(false))}</div>
              <p className='mt-4 text-[0.7rem] text-muted-foreground/80'>
                Conversations auto-save once you send the first message. Pin important threads to keep them handy.
              </p>
            </div>
          ) : null}

          <div className='relative flex-1'>
            <button
              type='button'
              className='absolute left-0 top-1/2 z-20 hidden -translate-x-1/2 -translate-y-1/2 rounded-full border border-border/40 bg-background/70 p-2 text-muted-foreground shadow-sm transition hover:text-foreground md:inline-flex'
              onClick={() => setHistoryOpen((value) => !value)}
              aria-label='Toggle history'
            >
              <History className='h-4 w-4' />
            </button>

            <div className='flex flex-col gap-3 rounded-2xl border border-border/40 bg-background/40 p-4'>
            <div className='flex items-center justify-between gap-3 text-sm text-muted-foreground'>
              {activeSession ? (
                <div className='flex items-center gap-2'>
                  <div>
                    <p className='font-medium text-foreground'>
                      {activeSession.title || 'Untitled conversation'}
                    </p>
                    <p className='text-xs uppercase tracking-wide'>
                      {activeSession.providerInstanceName} • {activeSession.model}
                    </p>
                  </div>
                  <Button
                    type='button'
                    size='icon'
                    variant='ghost'
                    className='h-7 w-7 rounded-full border border-border/40'
                    onClick={() => void handleTogglePin(activeSession)}
                    aria-label={activeSession.pinned ? 'Unpin conversation' : 'Pin conversation'}
                  >
                    {activeSession.pinned ? <PinOff className='h-4 w-4' /> : <Pin className='h-4 w-4' />}
                  </Button>
                </div>
              ) : (
                <p>Select a conversation or start a new chat.</p>
              )}
              <div className='text-xs uppercase tracking-wide text-muted-foreground/80'>
                {currentMessages.length} messages
              </div>
            </div>

              <div className='relative flex min-h-[320px] max-h-[calc(100svh-240px)] flex-col gap-3 overflow-hidden rounded-xl border border-border/30 bg-background/60 p-4'>
                <div className='flex-1 space-y-3 overflow-y-auto pr-1'>
                  {activeSession ? (
                    currentMessages.map(renderMessage)
                  ) : (
                    <div className='flex h-full flex-col items-center justify-center gap-2 text-sm text-muted-foreground'>
                      <Sparkles className='h-5 w-5 text-[#EC5763]' />
                      <p>No conversation selected.</p>
                      <p className='text-xs text-muted-foreground/80'>
                        Choose a previous chat or click “New chat” to begin.
                      </p>
                    </div>
                  )}
                  {assistantStream && assistantStream.sessionId === activeSessionId ? (
                    <div className='flex items-center gap-2 text-sm text-muted-foreground'>
                      <Loader2 className='h-4 w-4 animate-spin text-primary/80' />
                      <span>Assistant is thinking…</span>
                    </div>
                  ) : null}
                  <div ref={messagesEndRef} />
                </div>

                <div className='flex flex-col gap-2 rounded-xl border border-border/20 bg-background/70 p-3 shadow-sm backdrop-blur'>
                  <textarea
                    rows={2}
                    value={composerValue}
                    onChange={(event) => setComposerValue(event.target.value)}
                    placeholder={
                      activeSession
                        ? 'Ask a question or describe a task…'
                        : 'Select a conversation or start a new chat to begin.'
                    }
                    className='w-full resize-none rounded-lg border border-border/30 bg-background/60 px-3 py-2 text-sm text-foreground shadow-inner focus-visible:outline-none focus-visible:ring focus-visible:ring-ring'
                    disabled={sending || !activeSession}
                  />
                  <div className='flex items-center justify-between gap-3'>
                    <span className='text-xs text-muted-foreground'>
                      {activeSession
                        ? connectionId
                          ? 'Ready to stream responses.'
                          : 'Connecting to workspace…'
                        : 'Choose a conversation or start a new chat.'}
                    </span>
                    <Button
                      type='button'
                      size='sm'
                      className='min-w-[7rem]'
                      onClick={handleSendMessage}
                      disabled={sending || !composerValue.trim() || !connectionId || !activeSession}
                    >
                      {sending ? <Loader2 className='mr-2 h-4 w-4 animate-spin' /> : <Send className='mr-2 h-4 w-4' />}
                      Send
                    </Button>
                  </div>
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
    </div>
  );

}
