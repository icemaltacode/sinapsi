import { useCallback, useEffect, useMemo, useState } from 'react';
import { Clipboard, Eye, EyeOff, Loader2, Pencil, Plus, Trash2 } from 'lucide-react';

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
import { apiRequest } from '../../lib/api';
import { useAuth } from '../../context/auth-context';

interface ProviderItem {
  providerId: string;
  providerType: string;
  instanceName: string;
  status: 'active' | 'revoked' | 'pending';
  apiKey: string;
  secretId: string;
  createdAt: string;
  updatedAt: string;
  lastRotatedAt: string | null;
}

interface ProvidersResponse {
  items: ProviderItem[];
}

interface ProviderMutationResponse {
  item: ProviderItem;
}

const PROVIDER_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'openai', label: 'OpenAI' },
  { value: 'copilot', label: 'Copilot' },
  { value: 'claude', label: 'Claude' },
  { value: 'gemini', label: 'Gemini' }
];

const maskKey = (key: string) => {
  if (!key) return '—';
  if (key.length <= 6) {
    return '•'.repeat(key.length);
  }
  const visible = key.slice(-4);
  return `••••••••••••${visible}`;
};

function useProviders() {
  const { idToken } = useAuth();
  const [items, setItems] = useState<ProviderItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchProviders = useCallback(async () => {
    if (!idToken) return;
    setLoading(true);
    setError(null);
    try {
      const response = await apiRequest<ProvidersResponse>('/admin/providers', {
        token: idToken
      });
      setItems(response.items ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load providers');
    } finally {
      setLoading(false);
    }
  }, [idToken]);

  useEffect(() => {
    void fetchProviders();
  }, [fetchProviders]);

  const handleCreated = useCallback((item: ProviderItem) => {
    setItems((current) => [...current, item]);
  }, []);

  const handleUpdated = useCallback((item: ProviderItem) => {
    setItems((current) => current.map((provider) => (provider.providerId === item.providerId ? item : provider)));
  }, []);

  const handleDeleted = useCallback((providerId: string) => {
    setItems((current) => current.filter((provider) => provider.providerId !== providerId));
  }, []);

  return {
    items,
    loading,
    error,
    refresh: fetchProviders,
    onCreated: handleCreated,
    onUpdated: handleUpdated,
    onDeleted: handleDeleted
  };
}

function AddProviderDialog({ onCreated }: { onCreated: (item: ProviderItem) => void }) {
  const { idToken } = useAuth();
  const [open, setOpen] = useState(false);
  const [providerType, setProviderType] = useState('gpt');
  const [instanceName, setInstanceName] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = useCallback(() => {
    setProviderType('gpt');
    setInstanceName('');
    setApiKey('');
    setError(null);
  }, []);

  const handleOpenChange = (value: boolean) => {
    setOpen(value);
    if (!value) {
      reset();
    }
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!idToken) return;

    setLoading(true);
    setError(null);
    try {
      const response = await apiRequest<ProviderMutationResponse>('/admin/providers', {
        method: 'POST',
        token: idToken,
        body: {
          providerType,
          instanceName,
          apiKey
        }
      });
      onCreated(response.item);
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add provider');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button>
          <Plus className='mr-2 h-4 w-4' />
          Add provider
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add provider instance</DialogTitle>
          <DialogDescription>
            Store a managed API key in Secrets Manager for chat or upcoming integrations.
          </DialogDescription>
        </DialogHeader>

        <form className='space-y-4' onSubmit={handleSubmit}>
          <div className='grid gap-2'>
            <Label htmlFor='providerType'>Provider</Label>
            <select
              id='providerType'
              className='h-10 rounded-md border border-border bg-background px-3 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring focus-visible:ring-ring'
              value={providerType}
              onChange={(event) => setProviderType(event.target.value)}
            >
              {PROVIDER_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <div className='grid gap-2'>
            <Label htmlFor='instanceName'>Instance name</Label>
            <Input
              id='instanceName'
              required
              value={instanceName}
              onChange={(event) => setInstanceName(event.target.value)}
              placeholder='e.g. GPT-Teaching'
            />
          </div>

          <div className='grid gap-2'>
            <Label htmlFor='apiKey'>API key</Label>
            <Input
              id='apiKey'
              type='password'
              required
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              placeholder='sk-...'
            />
          </div>

          {error ? <p className='text-sm text-destructive'>{error}</p> : null}

          <DialogFooter className='flex flex-col gap-2 sm:flex-row sm:justify-end'>
            <DialogClose asChild>
              <Button type='button' variant='ghost'>
                Cancel
              </Button>
            </DialogClose>
            <Button type='submit' disabled={loading}>
              {loading ? (
                <>
                  <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                  Saving…
                </>
              ) : (
                'Save provider'
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EditProviderDialog({
  provider,
  onUpdated
}: {
  provider: ProviderItem;
  onUpdated: (item: ProviderItem) => void;
}) {
  const { idToken } = useAuth();
  const [open, setOpen] = useState(false);
  const [instanceName, setInstanceName] = useState(provider.instanceName);
  const [apiKey, setApiKey] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setInstanceName(provider.instanceName);
      setApiKey('');
      setError(null);
    }
  }, [open, provider.instanceName]);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!idToken) return;

    if (!instanceName.trim() && !apiKey.trim()) {
      setError('Update the instance name or provide a new key.');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const response = await apiRequest<ProviderMutationResponse>(
        `/admin/providers/${encodeURIComponent(provider.providerId)}`,
        {
          method: 'PUT',
          token: idToken,
          body: {
            instanceName: instanceName.trim() || undefined,
            apiKey: apiKey ? apiKey.trim() : undefined
          }
        }
      );
      onUpdated(response.item);
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update provider');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant='ghost' size='icon' className='text-muted-foreground hover:text-foreground'>
          <Pencil className='h-4 w-4' />
          <span className='sr-only'>Edit provider</span>
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit provider</DialogTitle>
          <DialogDescription>Rename the instance or rotate the stored API key.</DialogDescription>
        </DialogHeader>
        <form className='space-y-4' onSubmit={handleSubmit}>
          <div className='grid gap-2'>
            <Label htmlFor='edit-instance-name'>Instance name</Label>
            <Input
              id='edit-instance-name'
              value={instanceName}
              onChange={(event) => setInstanceName(event.target.value)}
            />
          </div>

          <div className='grid gap-2'>
            <Label htmlFor='edit-api-key'>Rotate API key</Label>
            <Input
              id='edit-api-key'
              type='password'
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              placeholder='Leave blank to keep current key'
            />
          </div>

          {error ? <p className='text-sm text-destructive'>{error}</p> : null}

          <DialogFooter className='flex flex-col gap-2 sm:flex-row sm:justify-end'>
            <DialogClose asChild>
              <Button type='button' variant='ghost'>
                Cancel
              </Button>
            </DialogClose>
            <Button type='submit' disabled={loading}>
              {loading ? (
                <>
                  <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                  Saving…
                </>
              ) : (
                'Save changes'
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DeleteProviderDialog({
  provider,
  onDeleted
}: {
  provider: ProviderItem;
  onDeleted: (providerId: string) => void;
}) {
  const { idToken } = useAuth();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleDelete = async () => {
    if (!idToken) return;
    setLoading(true);
    setError(null);
    try {
      await apiRequest(`/admin/providers/${encodeURIComponent(provider.providerId)}`, {
        method: 'DELETE',
        token: idToken
      });
      onDeleted(provider.providerId);
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete provider');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant='ghost' size='icon' className='text-destructive hover:text-destructive'>
          <Trash2 className='h-4 w-4' />
          <span className='sr-only'>Delete provider</span>
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete provider?</DialogTitle>
          <DialogDescription>
            This removes <span className='font-semibold text-foreground'>{provider.instanceName}</span>{' '}
            and permanently deletes the stored key from Secrets Manager. This action cannot be undone.
          </DialogDescription>
        </DialogHeader>

        {error ? <p className='text-sm text-destructive'>{error}</p> : null}

        <DialogFooter className='flex flex-col gap-2 sm:flex-row sm:justify-end'>
          <DialogClose asChild>
            <Button type='button' variant='ghost'>
              Cancel
            </Button>
          </DialogClose>
          <Button
            type='button'
            variant='destructive'
            onClick={handleDelete}
            disabled={loading}
            className='min-w-[7rem]'
          >
            {loading ? (
              <>
                <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                Deleting…
              </>
            ) : (
              'Delete'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function AdminProvidersPage() {
  const { items, loading, error, refresh, onCreated, onUpdated, onDeleted } = useProviders();
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const providersByType = useMemo(() => {
    const counts = new Map<string, number>();
    items.forEach((provider) => {
      counts.set(provider.providerType, (counts.get(provider.providerType) ?? 0) + 1);
    });
    return counts;
  }, [items]);

  const handleToggleReveal = (providerId: string) => {
    setRevealed((current) => ({ ...current, [providerId]: !current[providerId] }));
  };

  const handleCopy = async (provider: ProviderItem) => {
    try {
      await navigator.clipboard.writeText(provider.apiKey);
      setCopiedId(provider.providerId);
      setTimeout(() => setCopiedId((id) => (id === provider.providerId ? null : id)), 3000);
    } catch (err) {
      console.error('Failed to copy provider key', err);
    }
  };

  return (
    <div className='space-y-6'>
      <section className='flex flex-col gap-4 md:flex-row md:items-center md:justify-between'>
        <div>
          <h1 className='text-2xl font-semibold text-white'>Providers</h1>
          <p className='text-sm text-muted-foreground'>
            Manage provider instances and stored API keys. Keys are persisted securely in AWS Secrets Manager.
          </p>
        </div>
        <div className='flex items-center gap-3'>
          <Button variant='ghost' onClick={() => refresh()}>
            {loading ? (
              <>
                <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                Loading…
              </>
            ) : (
              'Refresh'
            )}
          </Button>
          <AddProviderDialog onCreated={onCreated} />
        </div>
      </section>

      {error ? (
        <div className='rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive'>
          {error}
        </div>
      ) : null}

      <section className='rounded-2xl border border-border/40 bg-card/70 p-4 shadow-xl backdrop-blur'>
        {loading ? (
          <div className='flex h-40 items-center justify-center text-sm text-muted-foreground'>
            <Loader2 className='mr-2 h-4 w-4 animate-spin' />
            Loading providers…
          </div>
        ) : items.length === 0 ? (
          <div className='flex h-40 flex-col items-center justify-center gap-2 text-sm text-muted-foreground'>
            <p>No providers stored yet.</p>
            <p>Add your first provider to unlock chat integrations.</p>
          </div>
        ) : (
          <>
            <div className='hidden overflow-x-auto md:block'>
              <table className='min-w-full divide-y divide-border/60 text-left text-sm'>
              <thead className='bg-white/5 text-xs uppercase tracking-wide text-muted-foreground/80'>
                <tr>
                  <th className='px-3 py-3 font-medium'>Provider</th>
                  <th className='px-3 py-3 font-medium'>Instance</th>
                  <th className='px-3 py-3 font-medium'>Key</th>
                  <th className='px-3 py-3 font-medium'>Last rotated</th>
                  <th className='px-3 py-3 font-medium'>Actions</th>
                </tr>
              </thead>
              <tbody className='divide-y divide-border/60 text-foreground/90'>
                {items.map((provider) => {
                  const isRevealed = revealed[provider.providerId];
                  return (
                    <tr key={provider.providerId} className='transition hover:bg-white/5'>
                      <td className='px-3 py-3'>
                        <div className='flex flex-col'>
                          <span className='font-medium text-white'>
                            {PROVIDER_OPTIONS.find((option) => option.value === provider.providerType)?.label ??
                              provider.providerType}
                          </span>
                          <span className='text-xs text-muted-foreground'>
                            {providersByType.get(provider.providerType) ?? 0} instance
                            {(providersByType.get(provider.providerType) ?? 0) === 1 ? '' : 's'}
                          </span>
                        </div>
                      </td>
                      <td className='px-3 py-3'>
                        <div className='flex flex-col'>
                          <span className='font-medium text-white'>{provider.instanceName}</span>
                          <span className='text-xs text-muted-foreground'>{provider.providerId}</span>
                        </div>
                      </td>
                      <td className='px-3 py-3 font-mono text-xs'>
                        {isRevealed ? provider.apiKey : maskKey(provider.apiKey)}
                      </td>
                      <td className='px-3 py-3 text-xs text-muted-foreground'>
                        {provider.lastRotatedAt
                          ? new Date(provider.lastRotatedAt).toLocaleString()
                          : 'n/a'}
                      </td>
                      <td className='px-3 py-3'>
                        <div className='flex items-center gap-2'>
                          <Button
                            variant='ghost'
                            size='icon'
                            className='text-muted-foreground hover:text-foreground'
                            onClick={() => handleToggleReveal(provider.providerId)}
                          >
                            {isRevealed ? (
                              <EyeOff className='h-4 w-4' />
                            ) : (
                              <Eye className='h-4 w-4' />
                            )}
                            <span className='sr-only'>Toggle key visibility</span>
                          </Button>
                          <Button
                            variant='ghost'
                            size='icon'
                            className='text-muted-foreground hover:text-foreground'
                            onClick={() => handleCopy(provider)}
                            disabled={!provider.apiKey}
                          >
                            <Clipboard className='h-4 w-4' />
                            <span className='sr-only'>Copy key</span>
                          </Button>
                          {copiedId === provider.providerId ? (
                            <span className='text-xs text-emerald-300'>Copied!</span>
                          ) : null}
                          <EditProviderDialog provider={provider} onUpdated={onUpdated} />
                          <DeleteProviderDialog provider={provider} onDeleted={onDeleted} />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            </div>

            <div className='space-y-3 md:hidden'>
              {items.map((provider) => {
                const isRevealed = revealed[provider.providerId];
                return (
                  <div
                    key={provider.providerId}
                    className='rounded-2xl border border-border/40 bg-background/80 p-4 shadow-sm backdrop-blur'
                  >
                    <div className='flex items-start justify-between gap-3'>
                      <div>
                        <p className='text-sm font-semibold text-white'>
                          {PROVIDER_OPTIONS.find((option) => option.value === provider.providerType)?.label ??
                            provider.providerType}
                        </p>
                        <p className='text-xs text-muted-foreground'>
                          {providersByType.get(provider.providerType) ?? 0} instance
                          {(providersByType.get(provider.providerType) ?? 0) === 1 ? '' : 's'}
                        </p>
                      </div>
                      <div className='flex items-center gap-2'>
                        <Button
                          variant='ghost'
                          size='icon'
                          className='h-8 w-8 rounded-full border border-border/30 text-muted-foreground transition hover:text-foreground'
                          onClick={() => handleToggleReveal(provider.providerId)}
                        >
                          {isRevealed ? <EyeOff className='h-4 w-4' /> : <Eye className='h-4 w-4' />}
                          <span className='sr-only'>Toggle key visibility</span>
                        </Button>
                        <Button
                          variant='ghost'
                          size='icon'
                          className='h-8 w-8 rounded-full border border-border/30 text-muted-foreground transition hover:text-foreground'
                          onClick={() => handleCopy(provider)}
                          disabled={!provider.apiKey}
                        >
                          <Clipboard className='h-4 w-4' />
                          <span className='sr-only'>Copy key</span>
                        </Button>
                        <EditProviderDialog provider={provider} onUpdated={onUpdated} />
                        <DeleteProviderDialog provider={provider} onDeleted={onDeleted} />
                      </div>
                    </div>

                    <div className='mt-3 space-y-2 text-sm text-muted-foreground'>
                      <div>
                        <span className='font-medium text-white'>{provider.instanceName}</span>
                        <p className='text-xs text-muted-foreground'>ID: {provider.providerId}</p>
                      </div>
                      <div>
                        <p className='font-mono text-xs break-all'>
                          {isRevealed ? provider.apiKey : maskKey(provider.apiKey)}
                        </p>
                        {copiedId === provider.providerId ? (
                          <span className='text-xs text-emerald-300'>Copied!</span>
                        ) : null}
                      </div>
                      <p className='text-xs text-muted-foreground'>
                        Last rotated:{' '}
                        {provider.lastRotatedAt
                          ? new Date(provider.lastRotatedAt).toLocaleString()
                          : 'n/a'}
                      </p>
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
