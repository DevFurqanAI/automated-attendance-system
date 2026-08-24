'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { todayInTz } from '@/lib/attendance/leave';

export function LeaveForm() {
  const router = useRouter();
  const today = todayInTz();
  const [fromDate, setFromDate] = useState(today);
  const [toDate, setToDate] = useState(today);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);

    const response = await fetch('/api/attendance/leave', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fromDate, toDate, reason: reason.trim() }),
    });

    const data = await response.json();

    if (!response.ok) {
      setError(data.error ?? 'Could not submit the request.');
      setBusy(false);
      return;
    }

    setDone(true);
    setBusy(false);
    setReason('');
    router.refresh();
  }

  if (done) {
    return (
      <div>
        <h2 className="text-lg font-bold text-brand-secondary">Request submitted</h2>
        <p className="mt-2 text-sm text-ink-muted">
          An HR administrator will review it.
        </p>
        <button
          type="button"
          className="btn-secondary mt-4 w-full"
          onClick={() => setDone(false)}
        >
          Submit another
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="fromDate" className="field-label">
            From
          </label>
          <input
            id="fromDate"
            type="date"
            className="field"
            value={fromDate}
            min={today}
            onChange={(e) => {
              setFromDate(e.target.value);
              if (toDate < e.target.value) setToDate(e.target.value);
            }}
            required
          />
        </div>
        <div>
          <label htmlFor="toDate" className="field-label">
            To
          </label>
          <input
            id="toDate"
            type="date"
            className="field"
            value={toDate}
            min={fromDate}
            onChange={(e) => setToDate(e.target.value)}
            required
          />
        </div>
      </div>

      <div>
        <label htmlFor="reason" className="field-label">
          Reason
        </label>
        <textarea
          id="reason"
          className="field"
          rows={3}
          maxLength={500}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          required
        />
      </div>

      {error && (
        <p
          role="alert"
          className="border-l-4 border-status-flagged bg-status-flagged-bg p-3 text-sm font-medium text-status-flagged"
        >
          {error}
        </p>
      )}

      <button type="submit" className="btn-primary w-full" disabled={busy}>
        {busy ? 'Submitting…' : 'Submit for approval'}
      </button>
    </form>
  );
}
