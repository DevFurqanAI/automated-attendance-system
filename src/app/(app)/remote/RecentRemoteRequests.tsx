'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { StatusBadge } from '@/components/StatusBadge';
import { formatDateTime } from '@/lib/format';
import type { Attendance } from '@/lib/types';

/** Lets an employee withdraw their own still-pending remote check-in request. */
export function RecentRemoteRequests({ initialRows }: { initialRows: Attendance[] }) {
  const router = useRouter();
  const [rows, setRows] = useState(initialRows);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function withdraw(id: string) {
    setBusyId(id);
    setError(null);

    const response = await fetch(`/api/attendance/remote?id=${id}`, { method: 'DELETE' });
    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      setError(data.error ?? 'Could not withdraw the request.');
      setBusyId(null);
      return;
    }

    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, status: 'withdrawn' } : r)));
    setBusyId(null);
    router.refresh();
  }

  if (rows.length === 0) return null;

  return (
    <section className="mt-8">
      <h2 className="text-sm font-bold uppercase tracking-wide text-ink-muted">
        Your recent requests
      </h2>

      {error && (
        <p
          role="alert"
          className="mt-3 border-l-4 border-status-flagged bg-status-flagged-bg p-3 text-sm font-medium text-status-flagged"
        >
          {error}
        </p>
      )}

      <ul className="mt-3 space-y-2">
        {rows.map((row) => (
          <li key={row.id} className="card p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-semibold text-ink">{row.remote_reason}</p>
                <p className="mt-1 text-sm text-ink-muted">
                  Claimed {formatDateTime(row.claimed_check_in_time)}
                  {row.claimed_check_out_time
                    ? ` → ${formatDateTime(row.claimed_check_out_time)}`
                    : ''}
                </p>
                <p className="mt-0.5 text-xs text-ink-faint">
                  Submitted {formatDateTime(row.submitted_at)}
                </p>
              </div>
              <div className="flex flex-col items-end gap-2">
                <StatusBadge status={row.status} />
                {row.status === 'pending' && (
                  <button
                    type="button"
                    className="text-xs font-semibold text-ink-faint underline"
                    disabled={busyId === row.id}
                    onClick={() => withdraw(row.id)}
                  >
                    {busyId === row.id ? 'Withdrawing…' : 'Withdraw'}
                  </button>
                )}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
