'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);

    const { error } = await createClient().auth.signInWithPassword({
      email: email.trim(),
      password,
    });

    if (error) {
      setError(
        error.message === 'Invalid login credentials'
          ? 'Email or password is incorrect.'
          : error.message,
      );
      setBusy(false);
      return;
    }

    // `next` is set by the middleware when it bounces an unauthenticated
    // request. Only honour same-site paths so it cannot be used as an
    // open redirect.
    const next = searchParams.get('next');
    const target = next?.startsWith('/') && !next.startsWith('//') ? next : '/';

    router.replace(target);
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div>
        <label htmlFor="email" className="field-label">
          Work email
        </label>
        <input
          id="email"
          type="email"
          className="field"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="username"
          inputMode="email"
          required
          autoFocus
        />
      </div>

      <div>
        <label htmlFor="password" className="field-label">
          Password
        </label>
        <input
          id="password"
          type="password"
          className="field"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          required
        />
      </div>

      {error && (
        <p
          role="alert"
          className="bg-status-flagged-bg px-3 py-2 text-sm font-medium text-status-flagged"
        >
          {error}
        </p>
      )}

      <button type="submit" className="btn-primary w-full" disabled={busy}>
        {busy ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  );
}
