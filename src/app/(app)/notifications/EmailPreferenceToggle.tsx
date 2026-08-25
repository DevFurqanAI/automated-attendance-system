'use client';

import { useState } from 'react';

/** Self-service email opt-in/out — in-app notifications always send regardless. */
export function EmailPreferenceToggle({ initialEnabled }: { initialEnabled: boolean }) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    const next = !enabled;
    setBusy(true);
    setError(null);

    const response = await fetch('/api/notifications/preferences', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ emailNotificationsEnabled: next }),
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      setError(data.error ?? 'Could not save your preference.');
      setBusy(false);
      return;
    }

    setEnabled(next);
    setBusy(false);
  }

  return (
    <div className="card mt-4 flex items-center justify-between gap-3 p-4">
      <div>
        <p className="text-sm font-semibold text-ink">Email notifications</p>
        <p className="mt-0.5 text-xs text-ink-faint">
          In-app notifications always send. This only controls the email mirror.
        </p>
        {error && <p className="mt-1 text-xs text-status-flagged">{error}</p>}
      </div>
      <label className="inline-flex cursor-pointer items-center gap-2 text-sm">
        <input type="checkbox" checked={enabled} disabled={busy} onChange={toggle} />
        {enabled ? 'On' : 'Off'}
      </label>
    </div>
  );
}
