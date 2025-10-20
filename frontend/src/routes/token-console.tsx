import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ClipboardCopy } from 'lucide-react';

import { Button } from '../components/ui/button';
import { useAuth } from '../context/auth-context';
import { cn } from '../lib/utils';

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL as string | undefined;

interface TokenDebugPanelProps {
  className?: string;
}

export function TokenDebugPanel({ className }: TokenDebugPanelProps) {
  const { user, idToken, signOut, isAdmin } = useAuth();
  const [copied, setCopied] = useState(false);

  const tokenPreview = useMemo(() => {
    if (!idToken) return '';
    return idToken.length > 120
      ? `${idToken.slice(0, 60)}…${idToken.slice(-30)}`
      : idToken;
  }, [idToken]);

  const handleCopy = async () => {
    if (!idToken) return;
    try {
      await navigator.clipboard.writeText(idToken);
      setCopied(true);
      setTimeout(() => setCopied(false), 3000);
    } catch (error) {
      console.error('Failed to copy token', error);
    }
  };

  return (
    <article
      className={cn(
        'rounded-2xl border border-border/40 bg-card/70 p-6 shadow-xl backdrop-blur',
        className
      )}
    >
      <div className='space-y-1'>
        <h2 className='text-2xl font-semibold tracking-tight text-white'>
          Welcome back, {user?.displayName?.split(' ')[0] ?? 'there'}
        </h2>
        <p className='text-sm text-muted-foreground'>
          Copy your Cognito ID token for testing protected API calls while we build the rest of the dashboard.
        </p>
      </div>

      {idToken ? (
        <div className='mt-6 rounded-xl border border-border/60 bg-background/70 p-4 font-mono text-xs text-muted-foreground shadow-inner shadow-black/30'>
          <header className='flex items-center justify-between pb-2 text-[0.7rem] uppercase tracking-wide text-muted-foreground/70'>
            <span>ID token</span>
            <span>{copied ? 'copied' : 'trimmed for display'}</span>
          </header>
          <code className='block break-all text-[0.75rem]'>{tokenPreview}</code>
          {apiBaseUrl ? (
            <p className='mt-3 text-[0.7rem] text-muted-foreground/80'>
              Base URL: <span className='font-semibold'>{apiBaseUrl}</span>
            </p>
          ) : null}
        </div>
      ) : null}

      <div className='mt-6 flex flex-wrap items-center gap-3'>
        <Button variant='outline' onClick={handleCopy} className='border-white/20 text-white hover:bg-white/10' disabled={!idToken}>
          <ClipboardCopy className='mr-2 h-4 w-4' />
          {copied ? 'Copied!' : 'Copy full token'}
        </Button>
        <Button asChild variant='default' className='bg-white/15 text-white hover:bg-white/25'>
          <Link to='/account'>Account settings</Link>
        </Button>
        {isAdmin ? (
          <Button asChild variant='outline' className='border-white/20 text-white hover:bg-white/10'>
            <Link to='/admin'>Go to admin</Link>
          </Button>
        ) : null}
        <Button variant='ghost' onClick={signOut} className='text-white/80 hover:text-white'>
          Sign out
        </Button>
      </div>
    </article>
  );
}
