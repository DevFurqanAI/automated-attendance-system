'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { toLocalInputValue } from '@/lib/format';
import { captureLocation } from '@/lib/geolocation';
import { REMOTE_CLAIM_MAX_AGE_DAYS, REMOTE_REASONS } from '@/lib/types';

export function RemoteForm() {
  const router = useRouter();
  const [reason, setReason] = useState<string>(REMOTE_REASONS[0]);
  const [otherReason, setOtherReason] = useState('');
  const [checkIn, setCheckIn] = useState('');
  const [checkOut, setCheckOut] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  /**
   * Client-side half of the 2-day rule (spec §7.4.3). This only disables the
   * out-of-range dates in the picker — the server re-validates the same window
   * independently, so editing the DOM buys nothing.
   */
  const { min, max } = useMemo(() => {
    const now = new Date();
    const earliest = new Date(now);
    earliest.setDate(earliest.getDate() - REMOTE_CLAIM_MAX_AGE_DAYS);
    return { min: toLocalInputValue(earliest), max: toLocalInputValue(now) };
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);

    const finalReason =
      reason === 'Other' ? otherReason.trim() : reason;

    if (!finalReason) {
      setError('Please describe the reason for this remote check-in.');
      setBusy(false);
      return;
    }

    // Best-effort only: a genuinely remote worker may be nowhere near a branch,
    // so a failed or denied fix must not block the request (spec §7.4.4).
    let fix: { lat: number; lng: number; accuracy: number | null } | null = null;
    try {
      fix = await captureLocation();
    } catch {
      fix = null;
    }

    const response = await fetch('/api/attendance/remote', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        reason: finalReason,
        // datetime-local gives wall-clock text; new Date() reads it in the
        // user's own zone, and toISOString normalises it for the server.
        claimedCheckIn: checkIn ? new Date(checkIn).toISOString() : '',
        claimedCheckOut: checkOut ? new Date(checkOut).toISOString() : '',
        lat: fix?.lat,
        lng: fix?.lng,
        accuracy: fix?.accuracy,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      setError(data.error ?? 'Could not submit the request.');
      setBusy(false);
      return;
    }

    setDone(true);
    setBusy(false);
    setCheckIn('');
    setCheckOut('');
    setOtherReason('');
    router.refresh();
  }

  if (done) {
    return (
      <div>
        <h2 className="text-lg font-bold text-brand-secondary">
          Request submitted
        </h2>
        <p className="mt-2 text-sm text-ink-muted">
          An HR administrator will review it. It will not count toward your
          attendance until it is approved.
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
      <div>
        <label htmlFor="reason" className="field-label">
          Reason
        </label>
        <select
          id="reason"
          className="field"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        >
          {REMOTE_REASONS.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
      </div>

      {reason === 'Other' && (
        <div>
          <label htmlFor="otherReason" className="field-label">
            Describe the reason
          </label>
          <textarea
            id="otherReason"
            className="field"
            rows={3}
            maxLength={500}
            value={otherReason}
            onChange={(e) => setOtherReason(e.target.value)}
            required
          />
        </div>
      )}

      <div>
        <label htmlFor="checkIn" className="field-label">
          Claimed start time
        </label>
        <input
          id="checkIn"
          type="datetime-local"
          className="field"
          value={checkIn}
          min={min}
          max={max}
          onChange={(e) => setCheckIn(e.target.value)}
          required
        />
        <p className="mt-1.5 text-xs text-ink-faint">
          You cannot claim work more than {REMOTE_CLAIM_MAX_AGE_DAYS} days ago.
          Ask HR to record anything older.
        </p>
      </div>

      <div>
        <label htmlFor="checkOut" className="field-label">
          Claimed end time{' '}
          <span className="font-normal text-ink-faint">(optional)</span>
        </label>
        <input
          id="checkOut"
          type="datetime-local"
          className="field"
          value={checkOut}
          min={checkIn || min}
          max={max}
          onChange={(e) => setCheckOut(e.target.value)}
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
