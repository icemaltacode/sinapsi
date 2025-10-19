import { useState } from 'react';
import type { FormEvent } from 'react';

import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { useAuth } from '../context/auth-context';

export function LoginView() {
  const { signInUser, message, loading } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    signInUser(username.trim(), password);
  };

  return (
    <main className='flex min-h-screen items-center justify-center bg-[radial-gradient(circle_at_top_left,_#232E60,_#0b1120_55%,_#06070d)] px-4 py-12 text-foreground'>
      <section className='w-full max-w-md space-y-6 rounded-2xl border border-border/40 bg-card/80 p-8 shadow-xl backdrop-blur'>
        <header className='space-y-1 text-center'>
          <h1 className='text-2xl font-semibold text-white'>Welcome to Sinapsi</h1>
          <p className='text-sm text-muted-foreground'>Sign in with your Cognito credentials to continue.</p>
        </header>

        {message ? (
          <p
            className={`rounded-lg border px-4 py-3 text-sm ${
              message.type === 'error'
                ? 'border-destructive/40 bg-destructive/10 text-destructive'
                : 'border-emerald-400/40 bg-emerald-400/15 text-emerald-100'
            }`}
          >
            {message.text}
          </p>
        ) : null}

        <form className='space-y-4' onSubmit={handleSubmit}>
          <div className='space-y-2'>
            <label className='text-sm font-medium text-muted-foreground' htmlFor='login-email'>
              Email
            </label>
            <Input
              id='login-email'
              type='email'
              autoComplete='username'
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              required
              placeholder='admin@icecampus.com'
            />
          </div>

          <div className='space-y-2'>
            <label className='text-sm font-medium text-muted-foreground' htmlFor='login-password'>
              Password
            </label>
            <Input
              id='login-password'
              type='password'
              autoComplete='current-password'
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
              placeholder='••••••••'
            />
          </div>

          <Button type='submit' className='w-full' disabled={loading}>
            {loading ? 'Signing in…' : 'Sign in'}
          </Button>
        </form>
      </section>
    </main>
  );
}
