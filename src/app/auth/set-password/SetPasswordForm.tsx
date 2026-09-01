'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { PasswordField } from '@/components/PasswordField';

/** Matches the Supabase project's minimum; the server enforces it regardless. */
const MIN_LENGTH = 8;

export function SetPasswordForm() {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (password.length < MIN_LENGTH) {
      setError(`Use at least ${MIN_LENGTH} characters.`);
      return;
    }
    if (password !== confirm) {
      setError('The two passwords do not match.');
      return;
    }

    setBusy(true);
    const { error: updateError } = await createClient().auth.updateUser({
      password,
    });

    if (updateError) {
      // The commonest cause by far is a session that expired while this form
      // sat open — the emailed link is only good for an hour.
      setError(
        /session|jwt|expired/i.test(updateError.message)
          ? 'This link has expired. Ask your HR administrator for a new invitation.'
          : updateError.message,
      );
      setBusy(false);
      return;
    }

    // The session's cookies were just rotated. `refresh()` makes the server
    // components re-read them, so the app shell renders as the signed-in user
    // rather than bouncing back to /login.
    router.replace('/');
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <PasswordField
        id="password"
        label="New password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        autoComplete="new-password"
        minLength={MIN_LENGTH}
        required
        autoFocus
        hint={`At least ${MIN_LENGTH} characters.`}
      />

      <PasswordField
        id="confirm"
        label="Repeat password"
        value={confirm}
        onChange={(e) => setConfirm(e.target.value)}
        autoComplete="new-password"
        required
      />

      {error && (
        <p
          role="alert"
          className="bg-status-flagged-bg px-3 py-2 text-sm font-medium text-status-flagged"
        >
          {error}
        </p>
      )}

      <button type="submit" className="btn-primary w-full" disabled={busy}>
        {busy ? 'Saving…' : 'Save password and continue'}
      </button>
    </form>
  );
}
