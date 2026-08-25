'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useRef, useState } from 'react';
import { QrScanner } from '@/components/QrScanner';
import { StatusBadge } from '@/components/StatusBadge';
import { formatDateTime, toLocalInputValue } from '@/lib/format';
import { captureLocation, LocationError } from '@/lib/geolocation';
import { FLAG_REASON_LABELS, type FlagReason, type Status } from '@/lib/types';

interface OpenShift {
  id: string;
  checkInTime: string;
  branchName: string;
  /** Set once a remote checkout has already been requested for this shift. */
  claimedCheckOutTime: string | null;
}

interface Result {
  status: Status;
  branchName: string;
  checkInTime: string | null;
  checkOutTime?: string | null;
  distanceMeters: number;
  flagReason: FlagReason | null;
  flagDetail: string | null;
  action: 'check-in' | 'check-out';
}

type Phase = 'idle' | 'scanning' | 'submitting' | 'done';

export function CheckInClient({ openShift }: { openShift: OpenShift | null }) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>('idle');
  const [statusText, setStatusText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);

  // Guards against the scan loop firing the same code several times while the
  // request is in flight.
  const submittingRef = useRef(false);

  const action = openShift ? 'check-out' : 'check-in';

  const handleScan = useCallback(
    async (token: string) => {
      if (submittingRef.current) return;
      submittingRef.current = true;

      setPhase('submitting');
      setError(null);
      setStatusText('QR code read. Confirming your location…');

      try {
        const fix = await captureLocation();

        setStatusText('Location confirmed. Recording attendance…');

        const response = await fetch(`/api/attendance/${action}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            token,
            lat: fix.lat,
            lng: fix.lng,
            accuracy: fix.accuracy,
            mockLocation: fix.mockLocation,
          }),
        });

        const data = await response.json();

        if (!response.ok) {
          setError(data.error ?? 'Something went wrong. Please try again.');
          setPhase('idle');
          submittingRef.current = false;
          return;
        }

        setResult({ ...data, action });
        setPhase('done');
        // Refresh the server component so the open-shift state is correct if
        // the user navigates back here.
        router.refresh();
      } catch (err) {
        setError(
          err instanceof LocationError
            ? err.message
            : 'Could not complete the request. Check your connection and try again.',
        );
        setPhase('idle');
        submittingRef.current = false;
      } finally {
        setStatusText(null);
      }
    },
    [action, router],
  );

  // ---- Result screen -------------------------------------------------------
  if (phase === 'done' && result) {
    const flagged = result.status === 'flagged';
    return (
      <div className="mx-auto max-w-md">
        <div className="card p-6">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h1 className="text-xl font-bold tracking-tight text-brand-secondary">
              {result.action === 'check-in' ? 'Checked in' : 'Checked out'}
            </h1>
            <StatusBadge status={result.status} />
          </div>

          <dl className="space-y-3 text-sm">
            <Row label="Branch" value={result.branchName} />
            <Row
              label={result.action === 'check-in' ? 'Check-in time' : 'Check-out time'}
              value={formatDateTime(
                result.action === 'check-in'
                  ? result.checkInTime
                  : (result.checkOutTime ?? null),
              )}
            />
            <Row label="Distance from branch" value={`${result.distanceMeters} m`} />
          </dl>

          {flagged && (
            <div
              role="alert"
              className="mt-5 border-l-4 border-status-flagged bg-status-flagged-bg p-4"
            >
              <p className="text-sm font-bold text-status-flagged">
                Sent to HR for review
                {result.flagReason
                  ? ` — ${FLAG_REASON_LABELS[result.flagReason]}`
                  : ''}
              </p>
              {result.flagDetail && (
                <p className="mt-1.5 text-sm text-ink-muted">{result.flagDetail}</p>
              )}
              <p className="mt-2 text-sm text-ink-muted">
                Your attendance has been recorded and will count once an HR
                administrator approves it.
              </p>
            </div>
          )}

          <div className="mt-6 flex flex-col gap-2">
            <Link href="/history" className="btn-primary">
              View my history
            </Link>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => {
                setResult(null);
                setPhase('idle');
                submittingRef.current = false;
              }}
            >
              Done
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ---- Scan screen ---------------------------------------------------------
  return (
    <div className="mx-auto max-w-md">
      <h1 className="text-2xl font-bold tracking-tight text-brand-secondary">
        {openShift ? 'Check out' : 'Check in'}
      </h1>
      <p className="mt-1.5 text-sm text-ink-muted">
        Scan the QR code at the branch entrance. Your location is checked at the
        same time.
      </p>

      {openShift && (
        <div className="mt-4 border-l-4 border-brand-primary bg-brand-primary-soft p-4">
          <p className="text-sm font-semibold text-brand-secondary">
            Currently checked in at {openShift.branchName}
          </p>
          <p className="mt-0.5 text-sm text-ink-muted">
            Since {formatDateTime(openShift.checkInTime)}
          </p>
        </div>
      )}

      {openShift && <RemoteCheckoutSection openShift={openShift} onSubmitted={() => router.refresh()} />}

      {phase === 'idle' && (
        <button
          type="button"
          className="btn-primary mt-5 w-full py-3.5 text-base"
          onClick={() => {
            setError(null);
            setPhase('scanning');
          }}
        >
          {openShift ? 'Scan to check out' : 'Scan to check in'}
        </button>
      )}

      {(phase === 'scanning' || phase === 'submitting') && (
        <div className="mt-5">
          <QrScanner
            onScan={handleScan}
            paused={phase === 'submitting'}
            onError={setError}
          />
          <p
            aria-live="polite"
            className="mt-3 text-center text-sm font-medium text-ink-muted"
          >
            {statusText ?? 'Point the camera at the branch QR code.'}
          </p>
          {phase === 'scanning' && (
            <button
              type="button"
              className="btn-secondary mt-3 w-full"
              onClick={() => setPhase('idle')}
            >
              Cancel
            </button>
          )}
        </div>
      )}

      {error && (
        <p
          role="alert"
          className="mt-4 border-l-4 border-status-flagged bg-status-flagged-bg p-3 text-sm font-medium text-status-flagged"
        >
          {error}
        </p>
      )}

      <div className="mt-8 border-t border-line pt-5">
        <p className="text-sm text-ink-muted">
          Working away from a branch today?
        </p>
        <Link href="/remote" className="btn-secondary mt-2 w-full">
          Request a remote check-in
        </Link>
      </div>
    </div>
  );
}

/**
 * For an employee who checked in via QR+GPS, then left for a meeting or an
 * errand and never made it back to scan out — there is otherwise no way to
 * close that shift (check-out requires a branch's QR code). Submits a
 * claimed check-out time + reason against the EXISTING open shift; HR
 * reviews it from there (see POST /api/attendance/remote-checkout).
 */
function RemoteCheckoutSection({
  openShift,
  onSubmitted,
}: {
  openShift: OpenShift;
  onSubmitted: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [time, setTime] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(Boolean(openShift.claimedCheckOutTime));

  if (done) {
    return (
      <div className="mt-4 border-l-4 border-status-flagged bg-status-flagged-bg p-4">
        <p className="text-sm font-semibold text-status-flagged">
          Remote checkout requested
        </p>
        <p className="mt-1 text-sm text-ink-muted">
          Claimed{' '}
          {formatDateTime(
            openShift.claimedCheckOutTime ?? new Date().toISOString(),
          )}
          . An HR administrator will review it — this shift stays open until
          they do.
        </p>
      </div>
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);

    const response = await fetch('/api/attendance/remote-checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        reason,
        claimedCheckOutTime: time ? new Date(time).toISOString() : undefined,
      }),
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      setError(data.error ?? 'Could not submit the request.');
      setBusy(false);
      return;
    }

    setDone(true);
    setBusy(false);
    onSubmitted();
  }

  if (!open) {
    return (
      <button
        type="button"
        className="mt-3 text-sm font-semibold text-brand-primary underline"
        onClick={() => setOpen(true)}
      >
        Can&apos;t get back to scan out? Request a remote checkout
      </button>
    );
  }

  return (
    <form onSubmit={submit} className="mt-4 border-l-4 border-line-strong bg-surface-muted p-4">
      <p className="text-sm font-semibold text-ink">Request a remote checkout</p>
      <p className="mt-1 text-xs text-ink-muted">
        For when you left mid-shift and won&apos;t be back at a branch — an HR
        administrator will review and close this shift.
      </p>

      <div className="mt-3">
        <label htmlFor="remoteCheckoutReason" className="field-label">
          Reason
        </label>
        <textarea
          id="remoteCheckoutReason"
          className="field"
          rows={2}
          maxLength={500}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          required
        />
      </div>

      <div className="mt-3">
        <label htmlFor="remoteCheckoutTime" className="field-label">
          When did you actually leave?{' '}
          <span className="font-normal text-ink-faint">(defaults to now)</span>
        </label>
        <input
          id="remoteCheckoutTime"
          type="datetime-local"
          className="field"
          value={time}
          max={toLocalInputValue(new Date())}
          onChange={(e) => setTime(e.target.value)}
        />
      </div>

      {error && (
        <p
          role="alert"
          className="mt-3 border-l-4 border-status-flagged bg-status-flagged-bg p-3 text-sm font-medium text-status-flagged"
        >
          {error}
        </p>
      )}

      <div className="mt-4 flex gap-2">
        <button type="submit" className="btn-primary" disabled={busy || !reason.trim()}>
          {busy ? 'Submitting…' : 'Submit for review'}
        </button>
        <button
          type="button"
          className="btn-secondary"
          disabled={busy}
          onClick={() => setOpen(false)}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-ink-muted">{label}</dt>
      <dd className="text-right font-semibold text-ink">{value}</dd>
    </div>
  );
}
