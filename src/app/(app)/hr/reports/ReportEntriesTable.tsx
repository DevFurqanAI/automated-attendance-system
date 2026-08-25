'use client';

import { useRouter } from 'next/navigation';
import { Fragment, useState } from 'react';
import type { ReportEntry } from '@/lib/attendance/report';
import { formatDateTime, formatDuration, toLocalInputValue } from '@/lib/format';
import { METHOD_LABELS, type Branch } from '@/lib/types';

/**
 * The approved-entries table on the Reports page, with an "Edit" action per
 * row — the HR-side counterpart to POST /api/hr/attendance's "Mark present":
 * this corrects a record that already exists, including an already-settled
 * one. See the PATCH handler's doc comment in src/app/api/hr/attendance/route.ts
 * for why that's safe here despite the review queue refusing to touch
 * anything settled.
 */
export function ReportEntriesTable({
  entries,
  branches,
}: {
  entries: ReportEntry[];
  branches: Branch[];
}) {
  const router = useRouter();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({
    checkIn: '',
    checkOut: '',
    branchId: '',
    status: 'approved' as 'approved' | 'declined',
    reason: '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function openEdit(e: ReportEntry) {
    setEditingId(e.id);
    setForm({
      checkIn: e.checkInTime ? toLocalInputValue(new Date(e.checkInTime)) : '',
      checkOut: e.checkOutTime ? toLocalInputValue(new Date(e.checkOutTime)) : '',
      branchId: e.branchId ?? '',
      status: 'approved',
      reason: '',
    });
    setError(null);
  }

  async function save(id: string) {
    setBusy(true);
    setError(null);

    const response = await fetch('/api/hr/attendance', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id,
        checkInTime: form.checkIn ? new Date(form.checkIn).toISOString() : undefined,
        checkOutTime: form.checkOut ? new Date(form.checkOut).toISOString() : null,
        branchId: form.branchId || null,
        status: form.status,
        reason: form.reason,
      }),
    });
    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      setError(data.error ?? 'Could not save the correction.');
      setBusy(false);
      return;
    }

    setEditingId(null);
    setBusy(false);
    router.refresh();
  }

  return (
    <div className="card mt-5 overflow-x-auto">
      <table className="w-full min-w-[52rem] border-collapse text-sm">
        <thead>
          <tr className="border-b border-line text-left">
            <Th>Employee</Th>
            <Th>Branch</Th>
            <Th>Check in</Th>
            <Th>Check out</Th>
            <Th>Hours</Th>
            <Th>Method</Th>
            <Th>&nbsp;</Th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e) => (
            <Fragment key={e.id}>
              <tr className="border-b border-line last:border-0">
                <td className="px-4 py-3">
                  <span className="font-semibold text-ink">{e.employeeName}</span>
                  <span className="block text-xs text-ink-faint">{e.employeeEmail}</span>
                </td>
                <td className="px-4 py-3">{e.branchName}</td>
                <td className="px-4 py-3">{formatDateTime(e.checkInTime)}</td>
                <td className="px-4 py-3">{formatDateTime(e.checkOutTime)}</td>
                <td className="px-4 py-3 tabular-nums">{formatDuration(e.hours)}</td>
                <td className="px-4 py-3">{METHOD_LABELS[e.method]}</td>
                <td className="px-4 py-3">
                  <button
                    type="button"
                    className="text-xs font-semibold text-brand-primary underline"
                    onClick={() => (editingId === e.id ? setEditingId(null) : openEdit(e))}
                  >
                    {editingId === e.id ? 'Cancel' : 'Edit'}
                  </button>
                </td>
              </tr>
              {editingId === e.id && (
                <tr className="border-b border-line last:border-0">
                  <td colSpan={7} className="bg-surface-muted px-4 py-4">
                    <p className="text-xs font-bold uppercase tracking-wide text-ink-muted">
                      Correct this record
                    </p>
                    <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                      <div>
                        <label className="field-label text-xs" htmlFor={`re-in-${e.id}`}>
                          Check in
                        </label>
                        <input
                          id={`re-in-${e.id}`}
                          type="datetime-local"
                          className="field text-sm"
                          value={form.checkIn}
                          onChange={(ev) => setForm((f) => ({ ...f, checkIn: ev.target.value }))}
                        />
                      </div>
                      <div>
                        <label className="field-label text-xs" htmlFor={`re-out-${e.id}`}>
                          Check out
                        </label>
                        <input
                          id={`re-out-${e.id}`}
                          type="datetime-local"
                          className="field text-sm"
                          value={form.checkOut}
                          onChange={(ev) => setForm((f) => ({ ...f, checkOut: ev.target.value }))}
                        />
                      </div>
                      <div>
                        <label className="field-label text-xs" htmlFor={`re-branch-${e.id}`}>
                          Branch
                        </label>
                        <select
                          id={`re-branch-${e.id}`}
                          className="field text-sm"
                          value={form.branchId}
                          onChange={(ev) => setForm((f) => ({ ...f, branchId: ev.target.value }))}
                        >
                          <option value="">None</option>
                          {branches.map((b) => (
                            <option key={b.id} value={b.id}>
                              {b.name}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="field-label text-xs" htmlFor={`re-status-${e.id}`}>
                          Status
                        </label>
                        <select
                          id={`re-status-${e.id}`}
                          className="field text-sm"
                          value={form.status}
                          onChange={(ev) =>
                            setForm((f) => ({
                              ...f,
                              status: ev.target.value as 'approved' | 'declined',
                            }))
                          }
                        >
                          <option value="approved">Approved</option>
                          <option value="declined">Declined</option>
                        </select>
                      </div>
                      <div>
                        <label className="field-label text-xs" htmlFor={`re-reason-${e.id}`}>
                          Reason
                        </label>
                        <input
                          id={`re-reason-${e.id}`}
                          className="field text-sm"
                          maxLength={500}
                          value={form.reason}
                          onChange={(ev) => setForm((f) => ({ ...f, reason: ev.target.value }))}
                        />
                      </div>
                    </div>

                    {error && (
                      <p role="alert" className="mt-3 text-sm font-medium text-status-flagged">
                        {error}
                      </p>
                    )}

                    <button
                      type="button"
                      className="btn-primary mt-4"
                      disabled={busy || !form.reason.trim()}
                      onClick={() => save(e.id)}
                    >
                      {busy ? 'Saving…' : 'Save correction'}
                    </button>
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="px-4 py-3 text-xs font-bold uppercase tracking-wide text-ink-muted">
      {children}
    </th>
  );
}
