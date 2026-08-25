'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { StatusBadge } from '@/components/StatusBadge';
import { formatDate, formatDateTime, toLocalInputValue } from '@/lib/format';
import { createClient } from '@/lib/supabase/client';
import {
  FLAG_REASON_LABELS,
  METHOD_LABELS,
  type AttendanceRow,
  type Branch,
  type DisputeRow,
  type LeaveRequestRow,
} from '@/lib/types';

type Tab = 'all' | 'pending' | 'flagged' | 'leave' | 'disputes';

/**
 * The single HR review surface (spec §7.5): pending remote requests, flagged
 * QR check-ins, pending leave requests, and open attendance disputes in one
 * place, updating live via Supabase Realtime so a second reviewer's decision
 * appears without a refresh.
 */
export function ReviewDashboard({
  initialRecords,
  initialLeaveRequests,
  initialDisputes,
  branches,
  currentUserId,
}: {
  initialRecords: AttendanceRow[];
  initialLeaveRequests: LeaveRequestRow[];
  initialDisputes: DisputeRow[];
  branches: Branch[];
  /** The signed-in reviewer, so their own records can be called out. */
  currentUserId: string;
}) {
  const [records, setRecords] = useState(initialRecords);
  const [leaveRequests, setLeaveRequests] = useState(initialLeaveRequests);
  const [disputes, setDisputes] = useState(initialDisputes);
  const [tab, setTab] = useState<Tab>('all');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState(false);

  const supabase = useMemo(() => createClient(), []);

  /**
   * Realtime gives us the raw row without its joined employee/branch names, so
   * on any change we re-read the queue. It is a small table and this keeps the
   * displayed names correct rather than showing "Unknown" for new arrivals.
   */
  const refresh = useCallback(async () => {
    const { data } = await supabase
      .from('attendance')
      .select(
        '*, employees:employee_id ( id, full_name, email ), branches:branch_id ( id, name ), checkout_branch:check_out_branch_id ( id, name )',
      )
      .in('status', ['pending', 'flagged'])
      .order('submitted_at', { ascending: false })
      .returns<AttendanceRow[]>();

    if (data) setRecords(data);
  }, [supabase]);

  const refreshLeave = useCallback(async () => {
    const { data } = await supabase
      .from('leave_requests')
      .select('*, employees:employee_id ( id, full_name, email )')
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
      .returns<LeaveRequestRow[]>();

    if (data) setLeaveRequests(data);
  }, [supabase]);

  const refreshDisputes = useCallback(async () => {
    const { data } = await supabase
      .from('disputes')
      .select(
        '*, employees:employee_id ( id, full_name, email ), attendance:attendance_id ( id, method, status, check_in_time, check_out_time )',
      )
      .eq('status', 'open')
      .order('created_at', { ascending: false })
      .returns<DisputeRow[]>();

    if (data) setDisputes(data);
  }, [supabase]);

  useEffect(() => {
    const channel = supabase
      .channel('hr-review-queue')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'attendance' },
        () => {
          refresh();
        },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'leave_requests' },
        () => {
          refreshLeave();
        },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'disputes' },
        () => {
          refreshDisputes();
        },
      )
      .subscribe((status) => {
        setLive(status === 'SUBSCRIBED');
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase, refresh, refreshLeave, refreshDisputes]);

  async function review(
    id: string,
    action: 'approve' | 'decline',
    overrides?: { checkInTime?: string; checkOutTime?: string | null; branchId?: string | null },
  ) {
    setBusyId(id);
    setError(null);

    const response = await fetch('/api/hr/review', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, action, ...overrides }),
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      setError(data.error ?? 'Could not save that decision.');
      setBusyId(null);
      return;
    }

    // Optimistic removal; the realtime event will reconcile anyway.
    setRecords((rows) => rows.filter((r) => r.id !== id));
    setBusyId(null);
  }

  /**
   * Closes a shift stuck with no check-out at all — no scan ever came in, so
   * it cannot go through the normal approve/decline flow (see the guard in
   * src/app/api/hr/review/route.ts). The realtime subscription above picks up
   * the resulting `flagged` row, so no optimistic removal here.
   */
  async function forceCheckout(id: string, checkOutTime: string) {
    setBusyId(id);
    setError(null);

    const response = await fetch('/api/hr/review', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id,
        action: 'force_checkout',
        checkOutTime: new Date(checkOutTime).toISOString(),
      }),
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      setError(data.error ?? 'Could not close the shift.');
    }

    setBusyId(null);
  }

  async function reviewLeave(id: string, action: 'approve' | 'decline') {
    setBusyId(id);
    setError(null);

    const response = await fetch('/api/hr/leave/review', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, action }),
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      setError(data.error ?? 'Could not save that decision.');
      setBusyId(null);
      return;
    }

    setLeaveRequests((rows) => rows.filter((r) => r.id !== id));
    setBusyId(null);
  }

  async function resolveDispute(id: string, resolutionNote: string) {
    setBusyId(id);
    setError(null);

    const response = await fetch('/api/hr/disputes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, resolutionNote }),
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      setError(data.error ?? 'Could not resolve the dispute.');
      setBusyId(null);
      return;
    }

    setDisputes((rows) => rows.filter((r) => r.id !== id));
    setBusyId(null);
  }

  const pending = records.filter((r) => r.status === 'pending');
  const flagged = records.filter((r) => r.status === 'flagged');
  const visible = tab === 'pending' ? pending : tab === 'flagged' ? flagged : records;

  // Bulk approve/decline — sequential over the existing single-record
  // endpoints, so per-record logic (self-review, remote-claim promotion)
  // never has to be duplicated server-side. Excludes any record still open
  // (no check-out scanned): those can only be closed via force-checkout, one
  // at a time, on the card itself.
  const [selectedRecordIds, setSelectedRecordIds] = useState<Set<string>>(new Set());
  const [selectedLeaveIds, setSelectedLeaveIds] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);

  function toggleRecordSelected(id: string) {
    setSelectedRecordIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function toggleLeaveSelected(id: string) {
    setSelectedLeaveIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function bulkReviewRecords(action: 'approve' | 'decline') {
    setBulkBusy(true);
    for (const id of selectedRecordIds) {
      await review(id, action);
    }
    setSelectedRecordIds(new Set());
    setBulkBusy(false);
  }

  async function bulkReviewLeave(action: 'approve' | 'decline') {
    setBulkBusy(true);
    for (const id of selectedLeaveIds) {
      await reviewLeave(id, action);
    }
    setSelectedLeaveIds(new Set());
    setBulkBusy(false);
  }

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-brand-secondary">
            Review queue
          </h1>
          <p className="mt-1.5 text-sm text-ink-muted">
            Remote requests awaiting approval and check-ins flagged by the
            system.
          </p>
        </div>
        <p className="flex items-center gap-2 text-xs font-semibold text-ink-muted">
          <span
            aria-hidden
            className={`inline-block h-2 w-2 rounded-full ${
              live ? 'bg-status-approved' : 'bg-line-strong'
            }`}
          />
          {live ? 'Live' : 'Connecting…'}
        </p>
      </div>

      <div className="mt-5 flex gap-1 border-b border-line">
        <TabButton active={tab === 'all'} onClick={() => setTab('all')}>
          All ({records.length})
        </TabButton>
        <TabButton active={tab === 'pending'} onClick={() => setTab('pending')}>
          Pending remote ({pending.length})
        </TabButton>
        <TabButton active={tab === 'flagged'} onClick={() => setTab('flagged')}>
          Flagged ({flagged.length})
        </TabButton>
        <TabButton active={tab === 'leave'} onClick={() => setTab('leave')}>
          Leave ({leaveRequests.length})
        </TabButton>
        <TabButton active={tab === 'disputes'} onClick={() => setTab('disputes')}>
          Disputes ({disputes.length})
        </TabButton>
      </div>

      {error && (
        <p
          role="alert"
          className="mt-4 border-l-4 border-status-flagged bg-status-flagged-bg p-3 text-sm font-medium text-status-flagged"
        >
          {error}
        </p>
      )}

      {tab === 'disputes' ? (
        disputes.length === 0 ? (
          <p className="card mt-5 p-10 text-center text-ink-muted">
            No open disputes.
          </p>
        ) : (
          <ul className="mt-5 space-y-3">
            {disputes.map((row) => (
              <DisputeCard
                key={row.id}
                row={row}
                busy={busyId === row.id}
                onResolve={resolveDispute}
              />
            ))}
          </ul>
        )
      ) : tab === 'leave' ? (
        leaveRequests.length === 0 ? (
          <p className="card mt-5 p-10 text-center text-ink-muted">
            Nothing to review. New requests appear here automatically.
          </p>
        ) : (
          <>
            {selectedLeaveIds.size > 0 && (
              <BulkToolbar
                count={selectedLeaveIds.size}
                busy={bulkBusy}
                onApprove={() => bulkReviewLeave('approve')}
                onDecline={() => bulkReviewLeave('decline')}
                onClear={() => setSelectedLeaveIds(new Set())}
              />
            )}
            <ul className="mt-5 space-y-3">
              {leaveRequests.map((row) => (
                <LeaveCard
                  key={row.id}
                  row={row}
                  isOwnRecord={row.employee_id === currentUserId}
                  busy={busyId === row.id}
                  onReview={reviewLeave}
                  selected={selectedLeaveIds.has(row.id)}
                  onToggleSelected={() => toggleLeaveSelected(row.id)}
                />
              ))}
            </ul>
          </>
        )
      ) : visible.length === 0 ? (
        <p className="card mt-5 p-10 text-center text-ink-muted">
          Nothing to review. New requests appear here automatically.
        </p>
      ) : (
        <>
          {selectedRecordIds.size > 0 && (
            <BulkToolbar
              count={selectedRecordIds.size}
              busy={bulkBusy}
              onApprove={() => bulkReviewRecords('approve')}
              onDecline={() => bulkReviewRecords('decline')}
              onClear={() => setSelectedRecordIds(new Set())}
            />
          )}
          <ul className="mt-5 space-y-3">
            {visible.map((row) => (
              <ReviewCard
                key={row.id}
                row={row}
                branches={branches}
                isOwnRecord={row.employee_id === currentUserId}
                busy={busyId === row.id}
                onReview={review}
                onForceCheckout={forceCheckout}
                selected={selectedRecordIds.has(row.id)}
                onToggleSelected={() => toggleRecordSelected(row.id)}
              />
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function DisputeCard({
  row,
  busy,
  onResolve,
}: {
  row: DisputeRow;
  busy: boolean;
  onResolve: (id: string, resolutionNote: string) => void;
}) {
  const [note, setNote] = useState('');
  const record = row.attendance;

  return (
    <li className="card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-bold text-brand-secondary">
            {row.employees?.full_name ?? 'Unknown employee'}
          </p>
          <p className="text-sm text-ink-muted">{row.employees?.email}</p>
        </div>
        <span className="badge bg-status-flagged-bg text-status-flagged">Open dispute</span>
      </div>

      <dl className="mt-4 grid gap-3 sm:grid-cols-2">
        <Field label="Filed">{formatDateTime(row.created_at)}</Field>
        <Field label="Record">
          {record ? (
            <>
              {METHOD_LABELS[record.method]} — {record.status}
              <span className="mt-0.5 block text-xs text-ink-faint">
                {formatDateTime(record.check_in_time)} → {formatDateTime(record.check_out_time)}
              </span>
            </>
          ) : (
            '—'
          )}
        </Field>
        <Field label="Employee's reason" className="sm:col-span-2">
          {row.reason}
        </Field>
      </dl>

      <p className="mt-4 text-xs text-ink-faint">
        Resolving does not change the record itself — correct it from the
        Reports page&apos;s Edit action first if the dispute is warranted,
        then resolve here.
      </p>

      <div className="mt-3">
        <label className="field-label text-xs" htmlFor={`resolve-${row.id}`}>
          Resolution note <span className="font-normal text-ink-faint">(optional)</span>
        </label>
        <input
          id={`resolve-${row.id}`}
          className="field text-sm"
          maxLength={500}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </div>

      <button
        type="button"
        className="btn-primary mt-4"
        disabled={busy}
        onClick={() => onResolve(row.id, note)}
      >
        {busy ? 'Saving…' : 'Resolve'}
      </button>
    </li>
  );
}

function LeaveCard({
  row,
  isOwnRecord,
  busy,
  onReview,
  selected,
  onToggleSelected,
}: {
  row: LeaveRequestRow;
  isOwnRecord: boolean;
  busy: boolean;
  onReview: (id: string, action: 'approve' | 'decline') => void;
  selected: boolean;
  onToggleSelected: () => void;
}) {
  return (
    <li className="card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <input
            type="checkbox"
            aria-label={`Select ${row.employees?.full_name ?? 'this request'}`}
            className="mt-1"
            checked={selected}
            onChange={onToggleSelected}
          />
          <div>
            <p className="font-bold text-brand-secondary">
              {row.employees?.full_name ?? 'Unknown employee'}
            </p>
            <p className="text-sm text-ink-muted">{row.employees?.email}</p>
          </div>
        </div>
        <StatusBadge status={row.status} />
      </div>

      <dl className="mt-4 grid gap-3 sm:grid-cols-2">
        <Field label="Dates">
          {formatDate(row.from_date)}
          {row.to_date !== row.from_date ? ` → ${formatDate(row.to_date)}` : ''}
        </Field>
        <Field label="Reason" className="sm:col-span-2">
          {row.reason}
        </Field>
      </dl>

      {isOwnRecord && (
        <p className="mt-4 border-l-4 border-brand-primary bg-brand-primary-soft p-3 text-sm text-brand-secondary">
          <span className="font-semibold">This is your own request.</span>{' '}
          Approving or declining it will be recorded as a self-review in the
          audit log.
        </p>
      )}

      <div className="mt-5 flex flex-col gap-2 sm:flex-row">
        <button
          type="button"
          className="btn-primary sm:w-40"
          disabled={busy}
          onClick={() => onReview(row.id, 'approve')}
        >
          {busy ? 'Saving…' : 'Approve'}
        </button>
        <button
          type="button"
          className="btn-danger sm:w-40"
          disabled={busy}
          onClick={() => onReview(row.id, 'decline')}
        >
          Decline
        </button>
      </div>
    </li>
  );
}

function ReviewCard({
  row,
  branches,
  isOwnRecord,
  busy,
  onReview,
  onForceCheckout,
  selected,
  onToggleSelected,
}: {
  row: AttendanceRow;
  branches: Branch[];
  isOwnRecord: boolean;
  busy: boolean;
  onReview: (
    id: string,
    action: 'approve' | 'decline',
    overrides?: { checkInTime?: string; checkOutTime?: string | null; branchId?: string | null },
  ) => void;
  onForceCheckout: (id: string, checkOutTime: string) => void;
  selected: boolean;
  onToggleSelected: () => void;
}) {
  const remote = row.method === 'remote_request';
  // A QR shift with no check-out at all: no scan ever came in, so it cannot
  // go through the normal approve/decline flow. Lost phone, crashed app, or
  // simply forgetting — see 'attendance.force_checkout' in src/lib/audit.ts.
  const stuckOpen = !remote && !row.check_out_time;
  // The employee may have already claimed a time via /api/attendance/remote-checkout
  // (flag_reason === 'remote_checkout_requested') — pre-fill it rather than
  // defaulting to "now" and making HR re-enter what was already submitted.
  const [forceCheckoutTime, setForceCheckoutTime] = useState(
    row.claimed_check_out_time
      ? toLocalInputValue(new Date(row.claimed_check_out_time))
      : toLocalInputValue(new Date()),
  );

  // HR may correct a claim before approving it (spec §7.4.7).
  const [checkIn, setCheckIn] = useState(
    row.claimed_check_in_time
      ? toLocalInputValue(new Date(row.claimed_check_in_time))
      : '',
  );
  const [checkOut, setCheckOut] = useState(
    row.claimed_check_out_time
      ? toLocalInputValue(new Date(row.claimed_check_out_time))
      : '',
  );
  const [branchId, setBranchId] = useState(row.branch_id ?? '');

  const approve = () =>
    onReview(
      row.id,
      'approve',
      remote
        ? {
            checkInTime: checkIn ? new Date(checkIn).toISOString() : undefined,
            checkOutTime: checkOut ? new Date(checkOut).toISOString() : null,
            branchId: branchId || null,
          }
        : undefined,
    );

  return (
    <li className="card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          {!stuckOpen && (
            <input
              type="checkbox"
              aria-label={`Select ${row.employees?.full_name ?? 'this record'}`}
              className="mt-1"
              checked={selected}
              onChange={onToggleSelected}
            />
          )}
          <div>
            <p className="font-bold text-brand-secondary">
              {row.employees?.full_name ?? 'Unknown employee'}
            </p>
            <p className="text-sm text-ink-muted">{row.employees?.email}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="badge bg-surface-muted text-ink-muted">
            {remote ? 'Remote request' : 'QR + GPS'}
          </span>
          <StatusBadge status={row.status} />
        </div>
      </div>

      {/* Submission vs claim, side by side — spec §7.4.6 */}
      <dl className="mt-4 grid gap-3 sm:grid-cols-2">
        <Field label="Submitted (server time)">
          {formatDateTime(row.submitted_at)}
        </Field>

        {remote ? (
          <>
            <Field label="Claimed work time">
              {formatDateTime(row.claimed_check_in_time)}
              {row.claimed_check_out_time
                ? ` → ${formatDateTime(row.claimed_check_out_time)}`
                : ''}
              <ClaimGap row={row} />
            </Field>
            <Field label="Reason" className="sm:col-span-2">
              {row.remote_reason ?? '—'}
            </Field>
          </>
        ) : (
          <>
            <Field label="Check-in (verified)">
              {formatDateTime(row.check_in_time)}
            </Field>
            <Field label="Branch (opened)">{row.branches?.name ?? '—'}</Field>
            {row.checkout_branch && (
              <Field label="Branch (closed)">{row.checkout_branch.name}</Field>
            )}
            <Field label="Reported position">
              {row.check_in_lat != null && row.check_in_lng != null
                ? `${Number(row.check_in_lat).toFixed(5)}, ${Number(row.check_in_lng).toFixed(5)}` +
                  (row.check_in_accuracy_meters
                    ? ` (±${Math.round(Number(row.check_in_accuracy_meters))} m)`
                    : '')
                : '—'}
            </Field>
          </>
        )}
      </dl>

      {row.flag_reason && (
        <p className="mt-4 border-l-4 border-status-flagged bg-status-flagged-bg p-3 text-sm font-semibold text-status-flagged">
          {FLAG_REASON_LABELS[row.flag_reason]}
          {/* A branch mismatch is meaningless without both branch names. */}
          {row.flag_reason === 'branch_mismatch' && row.checkout_branch && (
            <span className="mt-1 block font-normal">
              Opened at {row.branches?.name ?? 'an unknown branch'}, closed at{' '}
              {row.checkout_branch.name}.
            </span>
          )}
        </p>
      )}

      {/*
        Self-review is permitted — with one HR administrator there is often
        nobody else — but never silent. It is announced here, stamped on the
        response, and written to the audit log as a self-action.
      */}
      {isOwnRecord && (
        <p className="mt-4 border-l-4 border-brand-primary bg-brand-primary-soft p-3 text-sm text-brand-secondary">
          <span className="font-semibold">This is your own record.</span>{' '}
          Approving or declining it will be recorded as a self-review in the
          audit log.
        </p>
      )}

      {remote && (
        <div className="mt-4 border-t border-line pt-4">
          <p className="mb-3 text-xs font-bold uppercase tracking-wide text-ink-muted">
            Verified times to record on approval
          </p>
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <label className="field-label text-xs" htmlFor={`in-${row.id}`}>
                Check in
              </label>
              <input
                id={`in-${row.id}`}
                type="datetime-local"
                className="field text-sm"
                value={checkIn}
                onChange={(e) => setCheckIn(e.target.value)}
              />
            </div>
            <div>
              <label className="field-label text-xs" htmlFor={`out-${row.id}`}>
                Check out
              </label>
              <input
                id={`out-${row.id}`}
                type="datetime-local"
                className="field text-sm"
                value={checkOut}
                onChange={(e) => setCheckOut(e.target.value)}
              />
            </div>
            <div>
              <label className="field-label text-xs" htmlFor={`br-${row.id}`}>
                Attribute to branch
              </label>
              <select
                id={`br-${row.id}`}
                className="field text-sm"
                value={branchId}
                onChange={(e) => setBranchId(e.target.value)}
              >
                <option value="">Remote (no branch)</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
      )}

      {stuckOpen ? (
        <div className="mt-5 border-t border-line pt-4">
          <p className="mb-3 text-xs font-bold uppercase tracking-wide text-ink-muted">
            {row.claimed_check_out_time
              ? 'Employee requested a remote checkout — review the claimed time below'
              : 'No check-out was ever scanned — close this shift with a time you supply'}
          </p>
          {row.claimed_check_out_time && row.remote_reason && (
            <p className="mb-3 text-sm text-ink-muted">
              <span className="font-semibold text-ink">Reason:</span>{' '}
              {row.remote_reason}
            </p>
          )}
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <div>
              <label className="field-label text-xs" htmlFor={`force-out-${row.id}`}>
                Check-out time
              </label>
              <input
                id={`force-out-${row.id}`}
                type="datetime-local"
                className="field text-sm"
                value={forceCheckoutTime}
                onChange={(e) => setForceCheckoutTime(e.target.value)}
              />
            </div>
            <button
              type="button"
              className="btn-danger sm:w-48"
              disabled={busy || !forceCheckoutTime}
              onClick={() => onForceCheckout(row.id, forceCheckoutTime)}
            >
              {busy ? 'Saving…' : 'Force checkout'}
            </button>
          </div>
          <p className="mt-2 text-xs text-ink-faint">
            This does not approve the shift — it only supplies the missing
            check-out so it can be reviewed normally afterward.
          </p>
        </div>
      ) : (
        <div className="mt-5 flex flex-col gap-2 sm:flex-row">
          <button
            type="button"
            className="btn-primary sm:w-40"
            disabled={busy}
            onClick={approve}
          >
            {busy ? 'Saving…' : 'Approve'}
          </button>
          <button
            type="button"
            className="btn-danger sm:w-40"
            disabled={busy}
            onClick={() => onReview(row.id, 'decline')}
          >
            Decline
          </button>
        </div>
      )}
    </li>
  );
}

/** Surfaces how far apart submission and claim are, at a glance. */
function ClaimGap({ row }: { row: AttendanceRow }) {
  if (!row.claimed_check_in_time) return null;
  const gapMs =
    new Date(row.submitted_at).getTime() -
    new Date(row.claimed_check_in_time).getTime();
  const hours = gapMs / 3_600_000;
  if (hours < 12) return null;

  return (
    <span className="mt-1 block text-xs font-semibold text-status-pending">
      Submitted {hours >= 24 ? `${Math.floor(hours / 24)} day(s)` : `${Math.round(hours)} h`}{' '}
      after the claimed start
    </span>
  );
}

function Field({
  label,
  children,
  className = '',
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <dt className="text-xs font-bold uppercase tracking-wide text-ink-muted">
        {label}
      </dt>
      <dd className="mt-0.5 text-sm text-ink">{children}</dd>
    </div>
  );
}

function BulkToolbar({
  count,
  busy,
  onApprove,
  onDecline,
  onClear,
}: {
  count: number;
  busy: boolean;
  onApprove: () => void;
  onDecline: () => void;
  onClear: () => void;
}) {
  return (
    <div className="card mt-5 flex flex-wrap items-center gap-3 p-3">
      <p className="text-sm font-semibold text-ink">{count} selected</p>
      <button type="button" className="btn-primary" disabled={busy} onClick={onApprove}>
        {busy ? 'Saving…' : 'Approve selected'}
      </button>
      <button type="button" className="btn-danger" disabled={busy} onClick={onDecline}>
        Decline selected
      </button>
      <button type="button" className="btn-ghost" disabled={busy} onClick={onClear}>
        Clear selection
      </button>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'true' : undefined}
      className={`-mb-px border-b-2 px-4 py-2.5 text-sm font-semibold transition-colors ${
        active
          ? 'border-brand-primary text-brand-primary'
          : 'border-transparent text-ink-muted hover:text-ink'
      }`}
    >
      {children}
    </button>
  );
}
