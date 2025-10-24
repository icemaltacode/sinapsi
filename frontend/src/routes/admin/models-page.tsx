import { useCallback, useEffect, useState } from 'react';
import { Ban, Check, Loader2, Plus, RefreshCcw, Trash2, X } from 'lucide-react';

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
}

interface CacheResponse {
  providers: ProviderCache[];
}

interface RefreshResponse {
  message: string;
  providers: string[];
}

// Helper function to render capability icon
function renderCapabilityIcon(value: boolean | null | undefined): React.ReactNode {
  if (value === null || value === undefined) {
    return <Loader2 className='h-4 w-4 animate-spin text-blue-400' />;
  }
  if (value === true) {
    return <Check className='h-4 w-4 text-green-500' />;
  }
  return <X className='h-4 w-4 text-muted-foreground' />;
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

  const fetchCache = useCallback(async () => {
    if (!idToken) return;

    setLoading(true);
    setError(null);

    try {
      const response = await apiRequest<CacheResponse>('/admin/models/cache', {
        token: idToken
      });

      setProviders(response.providers || []);

      if (response.providers && response.providers.length > 0 && !selectedProvider) {
        setSelectedProvider(response.providers[0].providerId);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load model cache');
    } finally {
      setLoading(false);
    }
  }, [idToken, selectedProvider]);

  useEffect(() => {
    void fetchCache();
  }, [fetchCache]);

  const handleRefresh = async () => {
    if (!idToken) return;

    setRefreshing(true);
    setStatus('');
    setCurrentTaskProgress(0);
    setOverallProgress(0);
    setError(null);

    try {
      // ===== PHASE 1: Model Curation =====
      setStatus('Sending refresh request...');

      await apiRequest<RefreshResponse>('/admin/models/refresh', {
        method: 'POST',
        token: idToken
      });

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

        // Check if lastRefreshed timestamp changed
        let timestampChanged = false;
        for (const provider of cacheResponse.providers) {
          const oldTimestamp = initialTimestamps.get(provider.providerId);
          const newTimestamp = provider.lastRefreshed;

          if (newTimestamp && oldTimestamp !== newTimestamp) {
            timestampChanged = true;
            setProviders(cacheResponse.providers || []);
            break;
          }
        }

        if (timestampChanged) {
          setCurrentTaskProgress(100);
          setOverallProgress(50);
          setStatus('Models fetched. Testing capabilities...');
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
      const maxPollsPhase2 = 30; // 5 minutes
      pollCount = 0;
      const phase2StartTime = Date.now();
      let phase2Completed = false;

      while (pollCount < maxPollsPhase2) {
        pollCount++;

        // Update countdown progress bar
        const elapsed = Date.now() - phase2StartTime;
        const progress = Math.min((elapsed / phase1TimeoutMs) * 100, 100);
        setCurrentTaskProgress(progress);
        // Update overall progress proportionally (50-100% during Phase 2)
        setOverallProgress(50 + (progress * 0.5));

        // Fetch latest cache
        const cacheResponse = await apiRequest<CacheResponse>('/admin/models/cache', {
          token: idToken
        });

        // Check if all capabilities are populated (non-null/undefined)
        let allCapabilitiesPopulated = true;
        for (const provider of cacheResponse.providers) {
          for (const model of provider.models) {
            if (
              model.supportsImageGeneration == null ||
              model.supportsTTS == null ||
              model.supportsTranscription == null ||
              model.supportsFileUpload == null
            ) {
              allCapabilitiesPopulated = false;
              break;
            }
          }
          if (!allCapabilitiesPopulated) break;
        }

        if (allCapabilitiesPopulated) {
          setCurrentTaskProgress(100);
          setOverallProgress(100);
          setStatus('Complete');
          setProviders(cacheResponse.providers || []);
          phase2Completed = true;
          break;
        }

        // Wait before next poll
        if (pollCount < maxPollsPhase2) {
          await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
        }
      }

      if (!phase2Completed) {
        setStatus('Capability testing timed out (models may have incomplete data)');
        setError('Capability testing timed out');
      }
    } catch (err) {
      setStatus(`Error: ${err instanceof Error ? err.message : 'Refresh failed'}`);
      setError(err instanceof Error ? err.message : 'Failed to refresh models');
    } finally {
      setRefreshing(false);
    }
  };

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

  return (
    <div className='space-y-6'>
      <section className='flex flex-col gap-4 md:flex-row md:items-center md:justify-between'>
        <div>
          <h1 className='text-2xl font-semibold text-white'>Model Cache Management</h1>
          <p className='text-sm text-muted-foreground'>
            Manage AI model availability, blacklist unwanted models, and add custom models
          </p>
        </div>
        <Button onClick={handleRefresh} disabled={refreshing || loading}>
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

      <section className='flex items-center gap-4'>
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
          <div className='overflow-x-auto'>
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
                {models.map((model) => (
                  <tr
                    key={model.id}
                    className={`transition hover:bg-white/5 ${model.blacklisted ? 'opacity-50' : ''}`}
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
                ))}
              </tbody>
            </table>
          </div>
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
