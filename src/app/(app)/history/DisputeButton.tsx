'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

/** Lets an employee flag one of their own attendance records as wrong. */
export function DisputeButton({
  attendanceId,
  hasOpenDispute,
}: {
  attendanceId: string;
  hasOpenDispute: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(hasOpenDispute);

  if (submitted) {
    return <span className="text-xs font-semibold text-status-flagged">Disputed</span>;
  }

  if (!open) {
    return (
      <button
        type="button"
        className="text-xs font-semibold text-ink-faint underline"
        onClick={() => setOpen(true)}
      >
        Dispute
      </button>
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);

    const response = await fetch('/api/attendance/disputes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ attendanceId, reason }),
    });
    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      setError(data.error ?? 'Could not submit the dispute.');
      setBusy(false);
      return;
    }

    setSubmitted(true);
    setBusy(false);
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="min-w-[12rem]">
      <textarea
        className="field text-xs"
        rows={2}
        maxLength={500}
        placeholder="What looks wrong?"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        required
      />
      {error && <p className="mt-1 text-xs text-status-flagged">{error}</p>}
      <div className="mt-1 flex gap-2">
        <button type="submit" className="text-xs font-semibold text-brand-primary underline" disabled={busy}>
          {busy ? 'Submitting…' : 'Submit'}
        </button>
        <button
          type="button"
          className="text-xs text-ink-faint underline"
          disabled={busy}
          onClick={() => setOpen(false)}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
