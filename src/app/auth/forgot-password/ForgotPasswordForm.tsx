'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';

export function ForgotPasswordForm() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);

    // No `redirectTo`: the recovery template installed by
    // scripts/configure-auth.mjs already links to
    // /auth/confirm?…&next=/auth/set-password, which keeps the destination out
    // of a query string a crafted link could tamper with.
    const { error: sendError } = await createClient().auth.resetPasswordForEmail(
      email.trim(),
    );

    // Anything other than rate limiting is reported as success on purpose:
    // a different answer for a registered address turns this form into a way
    // to enumerate who works here.
    if (sendError && /rate|limit|too many/i.test(sendError.message)) {
      setError('Too many attempts. Please wait a few minutes and try again.');
      setBusy(false);
      return;
    }

    setSent(true);
    setBusy(false);
  }

  if (sent) {
    return (
      <div role="status">
        <p className="text-sm text-ink">
          If <span className="font-semibold">{email.trim()}</span> belongs to an
          account, a reset link is on its way.
        </p>
        <p className="mt-3 text-sm text-ink-muted">
          The link expires in an hour and works once. Check the spam folder
          before asking for another.
        </p>
      </div>
    );
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

      {error && (
        <p
          role="alert"
          className="bg-status-flagged-bg px-3 py-2 text-sm font-medium text-status-flagged"
        >
          {error}
        </p>
      )}

      <button type="submit" className="btn-primary w-full" disabled={busy}>
        {busy ? 'Sending…' : 'Email me a reset link'}
      </button>
    </form>
  );
}
