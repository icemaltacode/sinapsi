import { useCallback, useEffect, useState } from 'react';
import { Ban, Check, Globe, Loader2, Plus, RefreshCcw, Target, Trash2, X } from 'lucide-react';

import { Button } from '../../components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from '../../components/ui/dialog';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { useAuth } from '../../context/auth-context';
import { apiRequest } from '../../lib/api';
import { cn } from '../../lib/utils';

interface ModelItem {
  id: string;
  label: string;
  supportsImageGeneration: boolean | null;
  supportsTTS?: boolean | null;
  supportsTranscription?: boolean | null;
  supportsFileUpload?: boolean | null;
  source: 'curated' | 'manual';
  blacklisted?: boolean;
}

interface ProviderCache {
  providerId: string;
  providerName: string;
  models: ModelItem[];
  lastRefreshed: string | null;
  lastRefreshStatus?: 'ok' | 'error' | null;
  lastRefreshError?: string | null;
  lastRefreshAttempt?: string | null;
}

interface CacheResponse {
  providers: ProviderCache[];
}

interface RefreshResponse {
  message: string;
  providers: string[];
}

function collectCapabilityChanges(prev: ProviderCache[], next: ProviderCache[]): string[] {
  const prevMap = new Map(prev.map((provider) => [provider.providerId, provider]));
  const changed: string[] = [];

  for (const provider of next) {
    const prevProvider = prevMap.get(provider.providerId);
    if (!prevProvider) continue;

    const prevModels = new Map(prevProvider.models.map((model) => [model.id, model]));

    for (const model of provider.models) {
      const prevModel = prevModels.get(model.id);
      if (!prevModel) continue;

      const changedCapability =
        prevModel.supportsImageGeneration !== model.supportsImageGeneration ||
        prevModel.supportsTTS !== model.supportsTTS ||
        prevModel.supportsTranscription !== model.supportsTranscription ||
        prevModel.supportsFileUpload !== model.supportsFileUpload;

      if (changedCapability) {
        changed.push(`${provider.providerId}:${model.id}`);
      }
    }
  }

  return changed;
}

function countPendingCapabilities(providers: ProviderCache[]): number {
  let pending = 0;
  for (const provider of providers) {
    for (const model of provider.models) {
      if (
        model.supportsImageGeneration == null ||
        model.supportsTTS == null ||
        model.supportsTranscription == null ||
        model.supportsFileUpload == null
      ) {
        pending++;
      }
    }
  }
  return pending;
}

function formatRefreshTimestamp(isoString: string | null): string {
  if (!isoString) return 'Never refreshed';

  const date = new Date(isoString);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');

  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

function getLatestRefreshTimestamp(providers: ProviderCache[]): string | null {
  let latest: Date | null = null;

  for (const provider of providers) {
    if (provider.lastRefreshed) {
      const timestamp = new Date(provider.lastRefreshed);
      if (!latest || timestamp > latest) {
        latest = timestamp;
      }
    }
  }

  return latest ? latest.toISOString() : null;
}

// Helper function to render capability icon
function renderCapabilityIcon(value: boolean | null | undefined): React.ReactNode {
  const baseClass = 'inline-flex h-6 w-6 items-center justify-center rounded-full';

  if (value === null || value === undefined) {
    return (
      <span className={`${baseClass} bg-blue-500/10`}>
        <Loader2 className='h-4 w-4 animate-spin text-blue-400' />
      </span>
    );
  }
  if (value === true) {
    return (
      <span className={`${baseClass} bg-emerald-500/10`}>
        <Check className='h-4 w-4 text-emerald-400' />
      </span>
    );
  }
  return (
    <span className={`${baseClass} bg-muted/10`}>
      <X className='h-4 w-4 text-muted-foreground' />
    </span>
  );
}

export function AdminModelsPage() {
  const { idToken } = useAuth();
  const [providers, setProviders] = useState<ProviderCache[]>([]);
  const [selectedProvider, setSelectedProvider] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [status, setStatus] = useState<string>('');
  const [currentTaskProgress, setCurrentTaskProgress] = useState<number>(0);
  const [overallProgress, setOverallProgress] = useState<number>(0);
  const [error, setError] = useState<string | null>(null);
  const [lastChangedModels, setLastChangedModels] = useState<Set<string>>(new Set());
  const [capabilityTargetCount, setCapabilityTargetCount] = useState(0);

  const fetchCache = useCallback(async () => {
    if (!idToken) return;

    setLoading(true);
    setError(null);

    try {
      const response = await apiRequest<CacheResponse>('/admin/models/cache', {
        token: idToken
      });

      const list = response.providers || [];
      setProviders(list);

      if (response.providers && response.providers.length > 0 && !selectedProvider) {
        setSelectedProvider(response.providers[0].providerId);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load model cache');
    } finally {
      setLoading(false);
    }
  }, [idToken, selectedProvider]);

  const applyProvidersUpdate = useCallback((nextProviders: ProviderCache[]) => {
    setProviders((prev) => {
      const changes = collectCapabilityChanges(prev, nextProviders);
      if (changes.length > 0) {
        setLastChangedModels((prevSet) => {
          const updated = new Set(prevSet);
          changes.forEach((key) => updated.add(key));
          return updated;
        });
      }
      return nextProviders;
    });
  }, []);

  useEffect(() => {
    void fetchCache();
  }, [fetchCache]);

  const handleRefresh = async (specificProviderId?: string) => {
    if (!idToken) return;

    setRefreshing(true);
    setStatus('');
    setCurrentTaskProgress(0);
    setOverallProgress(0);
    setError(null);
    setCapabilityTargetCount(0);

    try {
      const refreshStartTime = Date.now();
      let capabilityProcessingTotal = 0;

      const detectRefreshError = (providersList: ProviderCache[]): string | null => {
        for (const provider of providersList) {
          if (provider.lastRefreshStatus === 'error') {
            if (!provider.lastRefreshAttempt) {
              return provider.lastRefreshError || 'Model refresh failed';
            }

            const attemptTime = new Date(provider.lastRefreshAttempt).getTime();
            if (Number.isNaN(attemptTime) || attemptTime >= refreshStartTime) {
              return provider.lastRefreshError || 'Model refresh failed';
            }
          }
        }
        return null;
      };

      // ===== PHASE 1: Model Curation =====
      setStatus('Sending refresh request...');

      // Build URL with optional provider filter
      const refreshUrl = specificProviderId
        ? `/admin/models/refresh?providerId=${encodeURIComponent(specificProviderId)}`
        : '/admin/models/refresh';

      const refreshResponse = await apiRequest<RefreshResponse>(refreshUrl, {
        method: 'POST',
        token: idToken
      });

      // Get list of providers being refreshed (from API response)
      const providersBeingRefreshed = refreshResponse.providers || [];

      setStatus('Fetching models...');

      // Store snapshot of current timestamps
      const initialTimestamps = new Map<string, string>();
      providers.forEach((p) => {
        if (p.lastRefreshed) {
          initialTimestamps.set(p.providerId, p.lastRefreshed);
        }
      });

      // Poll Phase 1: Wait for lastRefreshed to change
      const maxPollsPhase1 = 30; // 5 minutes
      const pollIntervalMs = 10000; // 10 seconds
      let pollCount = 0;
      let phase1Completed = false;

      const startTime = Date.now();
      const phase1TimeoutMs = maxPollsPhase1 * pollIntervalMs;

      while (pollCount < maxPollsPhase1) {
        pollCount++;

        // Update countdown progress bar
        const elapsed = Date.now() - startTime;
        const progress = Math.min((elapsed / phase1TimeoutMs) * 100, 100);
        setCurrentTaskProgress(progress);
        // Update overall progress proportionally (0-50% during Phase 1)
        setOverallProgress(progress * 0.5);

        // Fetch latest cache
        const cacheResponse = await apiRequest<CacheResponse>('/admin/models/cache', {
          token: idToken
        });

        const refreshError = detectRefreshError(cacheResponse.providers || []);
        if (refreshError) {
          setStatus(`Error: ${refreshError}`);
          setError(refreshError);
          setProviders(cacheResponse.providers || []);
          setRefreshing(false);
          return;
        }

        // Check if lastRefreshed timestamp changed
        let timestampChanged = false;
        for (const provider of cacheResponse.providers) {
          const oldTimestamp = initialTimestamps.get(provider.providerId);
          const newTimestamp = provider.lastRefreshed;

          if (newTimestamp && oldTimestamp !== newTimestamp) {
            timestampChanged = true;
            applyProvidersUpdate(cacheResponse.providers || []);
            break;
          }
        }

        if (timestampChanged) {
          setCurrentTaskProgress(100);
          setOverallProgress(50);
          setStatus('Models fetched. Testing capabilities...');
          const pending = countPendingCapabilities(cacheResponse.providers || []);
          capabilityProcessingTotal = pending;
          setCapabilityTargetCount(pending);
          phase1Completed = true;
          break;
        }

        // Wait before next poll
        if (pollCount < maxPollsPhase1) {
          await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
        }
      }

      if (!phase1Completed) {
        throw new Error('Model refresh timed out');
      }

      // ===== PHASE 2: Capability Testing =====
      const pollIntervalMsPhase2 = 5000;
      pollCount = 0;
      while (true) {
        pollCount++;

        // Fetch latest cache
        const cacheResponse = await apiRequest<CacheResponse>('/admin/models/cache', {
          token: idToken
        });

        const refreshError = detectRefreshError(cacheResponse.providers || []);
        if (refreshError) {
          setStatus(`Error: ${refreshError}`);
          setError(refreshError);
          applyProvidersUpdate(cacheResponse.providers || []);
          setRefreshing(false);
          return;
        }

        applyProvidersUpdate(cacheResponse.providers || []);

        // Filter to only providers being refreshed
        const providersToCheck = (cacheResponse.providers || []).filter(
          (p) => providersBeingRefreshed.includes(p.providerId)
        );

        const pending = countPendingCapabilities(providersToCheck);
        if (capabilityProcessingTotal === 0) {
          capabilityProcessingTotal = pending;
          setCapabilityTargetCount(pending);
        }

        const total = capabilityProcessingTotal || capabilityTargetCount || pending || 1;

        const completed = Math.max(total - pending, 0);

        const progress = total === 0 ? 100 : Math.min((completed / total) * 100, 100);
        setCurrentTaskProgress(progress);
        setOverallProgress(50 + progress * 0.5);

        if (pending === 0) {
          setCurrentTaskProgress(100);
          setOverallProgress(100);
          setStatus('Complete');
          applyProvidersUpdate(cacheResponse.providers || []);
          break;
        }

        // Wait before next poll
        await new Promise((resolve) => setTimeout(resolve, pollIntervalMsPhase2));
      }
    } catch (err) {
      setStatus(`Error: ${err instanceof Error ? err.message : 'Refresh failed'}`);
      setError(err instanceof Error ? err.message : 'Failed to refresh models');
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    if (lastChangedModels.size === 0) return;

    const timeout = setTimeout(() => {
      setLastChangedModels(new Set());
    }, 1500);

    return () => clearTimeout(timeout);
  }, [lastChangedModels]);

  const handleToggleBlacklist = async (modelId: string, currentlyBlacklisted: boolean) => {
    if (!idToken || !selectedProvider) return;

    try {
      await apiRequest('/admin/models/blacklist', {
        method: 'POST',
        token: idToken,
        body: {
          provider: selectedProvider,
          modelId,
          blacklisted: !currentlyBlacklisted
        }
      });

      // Update local state
      setProviders((prev) =>
        prev.map((p) =>
          p.providerId === selectedProvider
            ? {
                ...p,
                models: p.models.map((m) =>
                  m.id === modelId ? { ...m, blacklisted: !currentlyBlacklisted } : m
                )
              }
            : p
        )
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to toggle blacklist');
    }
  };

  const handleDeleteManual = async (modelId: string) => {
    if (!idToken || !selectedProvider) return;

    try {
      await apiRequest(`/admin/models/manual?provider=${selectedProvider}&modelId=${encodeURIComponent(modelId)}`, {
        method: 'DELETE',
        token: idToken
      });

      // Update local state
      setProviders((prev) =>
        prev.map((p) =>
          p.providerId === selectedProvider
            ? {
                ...p,
                models: p.models.filter((m) => m.id !== modelId)
              }
            : p
        )
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete model');
    }
  };

  const currentProvider = providers.find((p) => p.providerId === selectedProvider);
  const models = currentProvider?.models || [];
  const latestRefresh = getLatestRefreshTimestamp(providers);

  return (
    <div className='space-y-6'>
      <section className='flex flex-col gap-4 md:flex-row md:items-center md:justify-between'>
        <div>
          <h1 className='text-2xl font-semibold text-white'>Model Cache Management</h1>
          <p className='text-sm text-muted-foreground'>
            Manage AI model availability, blacklist unwanted models, and add custom models
          </p>
        </div>
        <div className='flex flex-col items-end gap-2'>
          <Button onClick={() => handleRefresh()} disabled={refreshing || loading}>
            {refreshing ? (
              <>
                <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                Refreshing...
              </>
            ) : (
              <>
                <RefreshCcw className='mr-2 h-4 w-4' />
                Refresh All Providers
              </>
            )}
          </Button>
          <div className='flex items-center gap-1.5 rounded-full bg-blue-500/10 px-3 py-1 text-xs text-blue-400 border border-blue-500/20'>
            <Globe className='h-3 w-3' />
            <span>{formatRefreshTimestamp(latestRefresh)}</span>
          </div>
        </div>
      </section>

      {error ? (
        <div className='rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive'>
          {error}
        </div>
      ) : null}

      {refreshing && (
        <section className='rounded-2xl border border-border/40 bg-card/70 p-4 shadow-xl backdrop-blur'>
          <h2 className='mb-3 text-sm font-medium text-white'>Refresh Status</h2>

          {/* Status Line */}
          <div className='mb-4 font-mono text-sm text-muted-foreground'>
            {status || 'Initializing...'}
          </div>

          {/* Current Task Progress */}
          <div className='mb-3'>
            <div className='mb-1 flex justify-between text-xs text-muted-foreground'>
              <span>Current Task</span>
              <span>{Math.round(currentTaskProgress)}%</span>
            </div>
            <div className='h-2 w-full overflow-hidden rounded-full bg-black/20'>
              <div
                className='h-full bg-blue-500 transition-all duration-300'
                style={{ width: `${currentTaskProgress}%` }}
              />
            </div>
          </div>

          {/* Overall Progress */}
          <div>
            <div className='mb-1 flex justify-between text-xs text-muted-foreground'>
              <span>Overall Progress</span>
              <span>{Math.round(overallProgress)}%</span>
            </div>
            <div className='h-2 w-full overflow-hidden rounded-full bg-black/20'>
              <div
                className='h-full bg-green-500 transition-all duration-300'
                style={{ width: `${overallProgress}%` }}
              />
            </div>
          </div>
        </section>
      )}

      <section className='flex items-center justify-between gap-4'>
        <div className='flex items-center gap-4'>
          <Label htmlFor='provider-select' className='text-white'>
            Provider:
          </Label>
          <select
            id='provider-select'
            value={selectedProvider}
            onChange={(e) => setSelectedProvider(e.target.value)}
            className='rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring'
          >
            {providers.map((p) => (
              <option key={p.providerId} value={p.providerId}>
                {p.providerName}
              </option>
            ))}
          </select>
          <Button
            variant='outline'
            size='sm'
            onClick={() => handleRefresh(selectedProvider)}
            disabled={refreshing || loading || !selectedProvider}
          >
            {refreshing ? (
              <>
                <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                Refreshing...
              </>
            ) : (
              <>
                <RefreshCcw className='mr-2 h-4 w-4' />
                Refresh Provider
              </>
            )}
          </Button>
          <AddManualModelDialog
            provider={selectedProvider}
            onAdded={(model) => {
              setProviders((prev) =>
                prev.map((p) =>
                  p.providerId === selectedProvider ? { ...p, models: [...p.models, model] } : p
                )
              );
            }}
          />
        </div>
        <div className='flex items-center gap-1.5 rounded-full bg-purple-500/10 px-3 py-1.5 text-xs text-purple-400 border border-purple-500/20'>
          <Target className='h-3 w-3' />
          <span>{formatRefreshTimestamp(currentProvider?.lastRefreshed ?? null)}</span>
        </div>
      </section>

      <section className='rounded-2xl border border-border/40 bg-card/70 p-4 shadow-xl backdrop-blur'>
        {loading ? (
          <div className='flex h-40 items-center justify-center text-sm text-muted-foreground'>
            <Loader2 className='mr-2 h-4 w-4 animate-spin' />
            Loading models...
          </div>
        ) : models.length === 0 ? (
          <div className='flex h-40 flex-col items-center justify-center gap-2 text-sm text-muted-foreground'>
            <p>No models cached for this provider.</p>
            <p>Try refreshing to populate the cache.</p>
          </div>
        ) : (
          <>
            <div className='hidden overflow-x-auto md:block'>
            <table className='min-w-full divide-y divide-border/60 text-left text-sm'>
              <thead className='bg-white/5 text-xs uppercase tracking-wide text-muted-foreground/80'>
                <tr>
                  <th className='px-3 py-3 font-medium'>Model ID</th>
                  <th className='px-3 py-3 font-medium'>Display Name</th>
                  <th className='px-3 py-3 font-medium'>Source</th>
                  <th className='px-3 py-3 text-center font-medium'>Image</th>
                  <th className='px-3 py-3 text-center font-medium'>TTS</th>
                  <th className='px-3 py-3 text-center font-medium'>Transcribe</th>
                  <th className='px-3 py-3 text-center font-medium'>Files</th>
                  <th className='px-3 py-3 font-medium'>Action</th>
                </tr>
              </thead>
              <tbody className='divide-y divide-border/60 text-foreground/90'>
                {models.map((model) => {
                  const providerId = currentProvider?.providerId ?? '';
                  const rowKey = `${providerId}:${model.id}`;
                  const isHighlighted = lastChangedModels.has(rowKey);

                  return (
                    <tr
                      key={model.id}
                      className={`transition hover:bg-white/5 ${model.blacklisted ? 'opacity-50' : ''} ${isHighlighted ? 'bg-emerald-500/10 ring-1 ring-emerald-400/40 transition-colors' : ''}`}
                    >
                    <td className='px-3 py-3 font-mono text-xs'>{model.id}</td>
                    <td className='px-3 py-3 font-medium text-white'>
                      {model.label}
                      {model.blacklisted && (
                        <span className='ml-2 text-xs text-destructive'>(Blacklisted)</span>
                      )}
                    </td>
                    <td className='px-3 py-3'>
                      <span
                        className={`rounded-full px-2 py-1 text-xs ${
                          model.source === 'curated'
                            ? 'bg-blue-500/20 text-blue-300'
                            : 'bg-purple-500/20 text-purple-300'
                        }`}
                      >
                        {model.source === 'curated' ? 'Curated' : 'Manual'}
                      </span>
                    </td>
                    <td className='px-3 py-3 text-center'>
                      {renderCapabilityIcon(model.supportsImageGeneration)}
                    </td>
                    <td className='px-3 py-3 text-center'>
                      {renderCapabilityIcon(model.supportsTTS)}
                    </td>
                    <td className='px-3 py-3 text-center'>
                      {renderCapabilityIcon(model.supportsTranscription)}
                    </td>
                    <td className='px-3 py-3 text-center'>
                      {renderCapabilityIcon(model.supportsFileUpload)}
                    </td>
                    <td className='px-3 py-3'>
                      {model.source === 'curated' ? (
                        <Button
                          variant='ghost'
                          size='icon'
                          onClick={() => handleToggleBlacklist(model.id, model.blacklisted || false)}
                          className='text-muted-foreground hover:text-foreground'
                        >
                          <Ban className='h-4 w-4' />
                          <span className='sr-only'>
                            {model.blacklisted ? 'Un-blacklist' : 'Blacklist'}
                          </span>
                        </Button>
                      ) : (
                        <Button
                          variant='ghost'
                          size='icon'
                          onClick={() => handleDeleteManual(model.id)}
                          className='text-destructive hover:text-destructive/80'
                        >
                          <Trash2 className='h-4 w-4' />
                          <span className='sr-only'>Delete</span>
                        </Button>
                      )}
                    </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            </div>

            <div className='space-y-3 md:hidden'>
              {models.map((model) => {
                const providerId = currentProvider?.providerId ?? '';
                const rowKey = `${providerId}:${model.id}`;
                const isHighlighted = lastChangedModels.has(rowKey);
                return (
                  <div
                    key={model.id}
                    className={cn(
                      'rounded-2xl border border-border/40 bg-background/80 p-4 shadow-sm backdrop-blur transition-colors',
                      isHighlighted && 'bg-emerald-500/10 ring-1 ring-emerald-400/40'
                    )}
                  >
                    <div className='flex items-start justify-between gap-3'>
                      <div className='min-w-0'>
                        <p className='text-sm font-semibold text-white truncate'>{model.label}</p>
                        <p className='font-mono text-xs text-muted-foreground break-all'>{model.id}</p>
                        <span
                          className={cn(
                            'mt-2 inline-flex items-center rounded-full px-2 py-0.5 text-[0.65rem]',
                            model.source === 'curated'
                              ? 'bg-blue-500/20 text-blue-300'
                              : 'bg-purple-500/20 text-purple-300'
                          )}
                        >
                          {model.source === 'curated' ? 'Curated' : 'Manual'}
                        </span>
                      </div>
                      <div className='flex items-center gap-2'>
                        {model.source === 'curated' ? (
                          <Button
                            variant='ghost'
                            size='icon'
                            onClick={() => handleToggleBlacklist(model.id, model.blacklisted || false)}
                            className='h-8 w-8 rounded-full border border-border/40 text-muted-foreground transition hover:text-foreground'
                          >
                            <Ban className='h-3.5 w-3.5' />
                            <span className='sr-only'>
                              {model.blacklisted ? 'Un-blacklist' : 'Blacklist'}
                            </span>
                          </Button>
                        ) : (
                          <Button
                            variant='ghost'
                            size='icon'
                            onClick={() => handleDeleteManual(model.id)}
                            className='h-8 w-8 rounded-full border border-border/40 text-destructive transition hover:text-destructive/80'
                          >
                            <Trash2 className='h-3.5 w-3.5' />
                            <span className='sr-only'>Delete</span>
                          </Button>
                        )}
                      </div>
                    </div>

                    <div className='mt-3 grid grid-cols-2 gap-2 text-xs text-muted-foreground'>
                      <div className='flex items-center gap-2 rounded-lg border border-border/40 bg-background/60 p-2'>
                        <span className='text-xs font-semibold'>Image</span>
                        {renderCapabilityIcon(model.supportsImageGeneration)}
                      </div>
                      <div className='flex items-center gap-2 rounded-lg border border-border/40 bg-background/60 p-2'>
                        <span className='text-xs font-semibold'>TTS</span>
                        {renderCapabilityIcon(model.supportsTTS)}
                      </div>
                      <div className='flex items-center gap-2 rounded-lg border border-border/40 bg-background/60 p-2'>
                        <span className='text-xs font-semibold'>Transcribe</span>
                        {renderCapabilityIcon(model.supportsTranscription)}
                      </div>
                      <div className='flex items-center gap-2 rounded-lg border border-border/40 bg-background/60 p-2'>
                        <span className='text-xs font-semibold'>Files</span>
                        {renderCapabilityIcon(model.supportsFileUpload)}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </section>
    </div>
  );
}

function AddManualModelDialog({
  provider,
  onAdded
}: {
  provider: string;
  onAdded: (model: ModelItem) => void;
}) {
  const { idToken } = useAuth();
  const [open, setOpen] = useState(false);
  const [modelId, setModelId] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [imageGen, setImageGen] = useState(false);
  const [fileUpload, setFileUpload] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!idToken || !provider) return;

    setLoading(true);
    setError(null);

    try {
      const response = await apiRequest<{ success: boolean; model: ModelItem }>(
        '/admin/models/manual',
        {
          method: 'POST',
          token: idToken,
          body: {
            provider,
            modelId: modelId.trim(),
            displayName: displayName.trim(),
            supportsImageGeneration: imageGen,
            supportsFileUpload: fileUpload
          }
        }
      );

      if (response.model) {
        onAdded(response.model);
      }

      setOpen(false);
      setModelId('');
      setDisplayName('');
      setImageGen(false);
      setFileUpload(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add model');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button disabled={!provider}>
          <Plus className='mr-2 h-4 w-4' />
          Add Manual Model
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add Manual Model</DialogTitle>
          <DialogDescription>
            Manually add a model to the cache. This model will persist across automatic refreshes.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className='space-y-4'>
          <div className='space-y-2'>
            <Label htmlFor='modelId'>Model ID</Label>
            <Input
              id='modelId'
              required
              value={modelId}
              onChange={(e) => setModelId(e.target.value)}
              placeholder='gpt-4-custom'
            />
          </div>
          <div className='space-y-2'>
            <Label htmlFor='displayName'>Display Name</Label>
            <Input
              id='displayName'
              required
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder='GPT-4 Custom'
            />
          </div>
          <div className='flex items-center space-x-2'>
            <input
              type='checkbox'
              id='imageGen'
              checked={imageGen}
              onChange={(e) => setImageGen(e.target.checked)}
              className='h-4 w-4 rounded border-gray-300'
            />
            <Label htmlFor='imageGen' className='cursor-pointer'>
              Supports Image Generation
            </Label>
          </div>
          <div className='flex items-center space-x-2'>
            <input
              type='checkbox'
              id='fileUpload'
              checked={fileUpload}
              onChange={(e) => setFileUpload(e.target.checked)}
              className='h-4 w-4 rounded border-gray-300'
            />
            <Label htmlFor='fileUpload' className='cursor-pointer'>
              Supports File Upload
            </Label>
          </div>

          {error ? <p className='text-sm text-destructive'>{error}</p> : null}

          <DialogFooter>
            <DialogClose asChild>
              <Button type='button' variant='ghost'>
                Cancel
              </Button>
            </DialogClose>
            <Button type='submit' disabled={loading}>
              {loading ? (
                <>
                  <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                  Adding...
                </>
              ) : (
                'Add Model'
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
