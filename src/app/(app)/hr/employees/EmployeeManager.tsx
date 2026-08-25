'use client';

import { useRouter } from 'next/navigation';
import { Fragment, useState } from 'react';
import { todayInTz } from '@/lib/attendance/leave';
import { parseCsv } from '@/lib/csv';
import { toLocalInputValue } from '@/lib/format';
import { WEEKDAY_LABELS, type Branch, type Employee, type Role } from '@/lib/types';

interface ImportRow {
  fullName: string;
  email: string;
  /** Set when the row fails basic validation — shown, but excluded from the send. */
  problem?: string;
}

/** True if the first row looks like a header rather than data (e.g. "Full name,Email"). */
function looksLikeHeader(row: string[]): boolean {
  return row.length >= 2 && !row[1].includes('@');
}

function parseImportRows(text: string): ImportRow[] {
  const raw = parseCsv(text);
  if (raw.length === 0) return [];
  const dataRows = looksLikeHeader(raw[0]) ? raw.slice(1) : raw;

  const seen = new Set<string>();
  return dataRows.map((cells): ImportRow => {
    const fullName = (cells[0] ?? '').trim();
    const email = (cells[1] ?? '').trim().toLowerCase();

    if (!email || !email.includes('@')) {
      return { fullName, email, problem: 'Missing or invalid email' };
    }
    if (!fullName) {
      return { fullName, email, problem: 'Missing name' };
    }
    if (seen.has(email)) {
      return { fullName, email, problem: 'Duplicate in this file' };
    }
    seen.add(email);
    return { fullName, email };
  });
}

export function EmployeeManager({
  employees,
  branches,
  currentUserId,
  currentUserRole,
  branchAssignments,
}: {
  employees: Employee[];
  branches: Branch[];
  currentUserId: string;
  currentUserRole: Role;
  branchAssignments: { hr_admin_id: string; branch_id: string }[];
}) {
  const router = useRouter();
  const isSuperAdmin = currentUserRole === 'super_admin';
  const [showInvite, setShowInvite] = useState(false);
  const [invite, setInvite] = useState({ fullName: '', email: '' });
  const [busyId, setBusyId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [branchSelections, setBranchSelections] = useState<Record<string, string[]>>(() => {
    const map: Record<string, string[]> = {};
    for (const a of branchAssignments) {
      (map[a.hr_admin_id] ??= []).push(a.branch_id);
    }
    return map;
  });

  const [showImport, setShowImport] = useState(false);
  const [importRows, setImportRows] = useState<ImportRow[]>([]);
  const [importBusy, setImportBusy] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importNotice, setImportNotice] = useState<string | null>(null);

  async function handleImportFile(file: File) {
    const text = await file.text();
    setImportRows(parseImportRows(text));
    setImportError(null);
    setImportNotice(null);
  }

  async function submitImport() {
    const valid = importRows.filter((r) => !r.problem);
    if (valid.length === 0) return;

    setImportBusy(true);
    setImportError(null);
    setImportNotice(null);

    const response = await fetch('/api/hr/employees', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        invites: valid.map((r) => ({ fullName: r.fullName, email: r.email })),
      }),
    });
    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      setImportError(data.error ?? 'Could not send the invites.');
      setImportBusy(false);
      return;
    }

    const failedCount = data.failed?.length ?? 0;
    setImportNotice(
      failedCount > 0
        ? `Sent ${data.succeeded.length} invite(s); ${failedCount} failed (${data.failed
            .map((f: { email: string; error: string }) => `${f.email}: ${f.error}`)
            .join('; ')}).`
        : `Sent ${data.succeeded.length} invite(s).`,
    );
    setImportRows([]);
    setImportBusy(false);
    router.refresh();
  }

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [roleFilter, setRoleFilter] = useState<'all' | Role>('all');

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showBulkPresent, setShowBulkPresent] = useState(false);
  const [bulkPresentForm, setBulkPresentForm] = useState({
    checkIn: '',
    checkOut: '',
    branchId: '',
    note: '',
  });
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [bulkNotice, setBulkNotice] = useState<string | null>(null);

  function toggleSelected(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function submitBulkPresent() {
    setBulkBusy(true);
    setBulkError(null);
    setBulkNotice(null);

    const response = await fetch('/api/hr/attendance', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        employeeIds: [...selected],
        checkInTime: bulkPresentForm.checkIn
          ? new Date(bulkPresentForm.checkIn).toISOString()
          : undefined,
        checkOutTime: bulkPresentForm.checkOut
          ? new Date(bulkPresentForm.checkOut).toISOString()
          : undefined,
        branchId: bulkPresentForm.branchId || undefined,
        note: bulkPresentForm.note || undefined,
      }),
    });
    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      setBulkError(data.error ?? 'Could not mark the selected employees present.');
      setBulkBusy(false);
      return;
    }

    const failedCount = data.failed?.length ?? 0;
    setBulkNotice(
      failedCount > 0
        ? `Marked ${data.succeeded} present; ${failedCount} failed (${data.failed
            .map((f: { error: string }) => f.error)
            .join('; ')}).`
        : `Marked ${data.succeeded ?? selected.size} employee(s) present.`,
    );
    setBulkBusy(false);
    setShowBulkPresent(false);
    setSelected(new Set());
    router.refresh();
  }

  const visibleEmployees = employees.filter((emp) => {
    if (statusFilter === 'active' && !emp.active) return false;
    if (statusFilter === 'inactive' && emp.active) return false;
    if (roleFilter !== 'all' && emp.role !== roleFilter) return false;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      if (!emp.full_name.toLowerCase().includes(q) && !emp.email.toLowerCase().includes(q)) {
        return false;
      }
    }
    return true;
  });

  async function sendInvite(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);

    const response = await fetch('/api/hr/employees', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(invite),
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      setError(data.error ?? 'Could not send the invite.');
      setBusy(false);
      return;
    }

    setNotice(`Invite sent to ${invite.email}.`);
    setInvite({ fullName: '', email: '' });
    setShowInvite(false);
    setBusy(false);
    router.refresh();
  }

  async function update(id: string, patch: Record<string, unknown>) {
    setBusyId(id);
    setError(null);

    const response = await fetch('/api/hr/employees', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, ...patch }),
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      setError(data.error ?? 'Could not update the employee.');
    }

    setBusyId(null);
    router.refresh();
  }

  async function saveBranches(hrAdminId: string) {
    setBusyId(hrAdminId);
    setError(null);

    const response = await fetch('/api/hr/branch-assignments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        hrAdminId,
        branchIds: branchSelections[hrAdminId] ?? [],
      }),
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      setError(data.error ?? 'Could not update branch assignments.');
    }

    setBusyId(null);
    router.refresh();
  }

  const [editingEmailId, setEditingEmailId] = useState<string | null>(null);
  const [emailDraft, setEmailDraft] = useState('');

  function startEditEmail(emp: Employee) {
    setEditingEmailId(emp.id);
    setEmailDraft(emp.email);
  }

  async function saveEmail(id: string) {
    await update(id, { email: emailDraft.trim() });
    setEditingEmailId(null);
  }

  const [markPresentId, setMarkPresentId] = useState<string | null>(null);
  const [markPresentForm, setMarkPresentForm] = useState({
    checkIn: '',
    checkOut: '',
    branchId: '',
    note: '',
  });
  const [markPresentBusy, setMarkPresentBusy] = useState(false);
  const [markPresentError, setMarkPresentError] = useState<string | null>(null);

  function openMarkPresent(id: string) {
    setMarkPresentId(id);
    setMarkPresentForm({ checkIn: toLocalInputValue(new Date()), checkOut: '', branchId: '', note: '' });
    setMarkPresentError(null);
  }

  async function submitMarkPresent(employeeId: string) {
    setMarkPresentBusy(true);
    setMarkPresentError(null);

    const response = await fetch('/api/hr/attendance', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        employeeId,
        checkInTime: markPresentForm.checkIn
          ? new Date(markPresentForm.checkIn).toISOString()
          : undefined,
        checkOutTime: markPresentForm.checkOut
          ? new Date(markPresentForm.checkOut).toISOString()
          : undefined,
        branchId: markPresentForm.branchId || undefined,
        note: markPresentForm.note || undefined,
      }),
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      setMarkPresentError(data.error ?? 'Could not create the record.');
      setMarkPresentBusy(false);
      return;
    }

    setMarkPresentId(null);
    setMarkPresentBusy(false);
    router.refresh();
  }

  const [markAbsentId, setMarkAbsentId] = useState<string | null>(null);
  const [markAbsentDate, setMarkAbsentDate] = useState('');
  const [markAbsentBusy, setMarkAbsentBusy] = useState(false);
  const [markAbsentError, setMarkAbsentError] = useState<string | null>(null);

  function openMarkAbsent(id: string) {
    setMarkAbsentId(id);
    setMarkAbsentDate(todayInTz());
    setMarkAbsentError(null);
  }

  async function submitMarkAbsent(employeeId: string) {
    setMarkAbsentBusy(true);
    setMarkAbsentError(null);

    const response = await fetch('/api/hr/absences', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ employeeId, date: markAbsentDate }),
    });
    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      setMarkAbsentError(data.error ?? 'Could not mark the absence.');
      setMarkAbsentBusy(false);
      return;
    }

    setMarkAbsentId(null);
    setMarkAbsentBusy(false);
    router.refresh();
  }

  const [markLeaveId, setMarkLeaveId] = useState<string | null>(null);
  const [markLeaveForm, setMarkLeaveForm] = useState({ fromDate: '', toDate: '', reason: '' });
  const [markLeaveBusy, setMarkLeaveBusy] = useState(false);
  const [markLeaveError, setMarkLeaveError] = useState<string | null>(null);

  function openMarkLeave(id: string) {
    setMarkLeaveId(id);
    const today = todayInTz();
    setMarkLeaveForm({ fromDate: today, toDate: today, reason: '' });
    setMarkLeaveError(null);
  }

  async function submitMarkLeave(employeeId: string) {
    setMarkLeaveBusy(true);
    setMarkLeaveError(null);

    const response = await fetch('/api/hr/leave/mark', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ employeeId, ...markLeaveForm }),
    });
    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      setMarkLeaveError(data.error ?? 'Could not record the leave.');
      setMarkLeaveBusy(false);
      return;
    }

    setMarkLeaveId(null);
    setMarkLeaveBusy(false);
    router.refresh();
  }

  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  function openDelete(id: string) {
    setDeletingId(id);
    setDeleteConfirmText('');
    setDeleteError(null);
  }

  async function confirmDelete(emp: Employee) {
    setDeleteBusy(true);
    setDeleteError(null);

    const response = await fetch(
      `/api/hr/employees?id=${emp.id}&confirmEmail=${encodeURIComponent(deleteConfirmText.trim())}`,
      { method: 'DELETE' },
    );
    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      setDeleteError(data.error ?? 'Could not delete the employee.');
      setDeleteBusy(false);
      return;
    }

    setDeletingId(null);
    setDeleteBusy(false);
    router.refresh();
  }

  function toggleWeeklyOffDay(emp: Employee, day: number) {
    const current = emp.weekly_off_days ?? [];
    const next = current.includes(day)
      ? current.filter((d) => d !== day)
      : [...current, day].sort((a, b) => a - b);
    update(emp.id, { weeklyOffDays: next });
  }

  function toggleBranchSelection(hrAdminId: string, branchId: string) {
    setBranchSelections((prev) => {
      const current = prev[hrAdminId] ?? [];
      const next = current.includes(branchId)
        ? current.filter((id) => id !== branchId)
        : [...current, branchId];
      return { ...prev, [hrAdminId]: next };
    });
  }

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-brand-secondary">
            Employees
          </h1>
          <p className="mt-1.5 text-sm text-ink-muted">
            Deactivating keeps a person&apos;s attendance history but blocks
            sign-in.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            className="btn-secondary"
            onClick={() => setShowInvite((v) => !v)}
          >
            {showInvite ? 'Cancel' : 'Invite employee'}
          </button>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => setShowImport((v) => !v)}
          >
            {showImport ? 'Cancel' : 'Bulk import (CSV)'}
          </button>
        </div>
      </div>

      {error && (
        <p
          role="alert"
          className="mt-4 border-l-4 border-status-flagged bg-status-flagged-bg p-3 text-sm font-medium text-status-flagged"
        >
          {error}
        </p>
      )}
      {notice && (
        <p className="mt-4 border-l-4 border-brand-primary bg-brand-primary-soft p-3 text-sm font-medium text-brand-secondary">
          {notice}
        </p>
      )}

      {showInvite && (
        <form onSubmit={sendInvite} className="card mt-5 p-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="fullName" className="field-label">
                Full name
              </label>
              <input
                id="fullName"
                className="field"
                value={invite.fullName}
                onChange={(e) =>
                  setInvite({ ...invite, fullName: e.target.value })
                }
                required
              />
            </div>
            <div>
              <label htmlFor="email" className="field-label">
                Work email
              </label>
              <input
                id="email"
                type="email"
                className="field"
                value={invite.email}
                onChange={(e) => setInvite({ ...invite, email: e.target.value })}
                required
              />
            </div>
          </div>
          <p className="mt-3 text-xs text-ink-faint">
            Supabase emails an invite link. They set their own password and are
            added as an employee; promote to HR below if needed.
          </p>
          <button type="submit" className="btn-primary mt-4" disabled={busy}>
            {busy ? 'Sending…' : 'Send invite'}
          </button>
        </form>
      )}

      {showImport && (
        <div className="card mt-5 p-5">
          <label htmlFor="importFile" className="field-label">
            CSV file
          </label>
          <input
            id="importFile"
            type="file"
            accept=".csv,text/csv"
            className="field"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleImportFile(file);
            }}
          />
          <p className="mt-1.5 text-xs text-ink-faint">
            Two columns: full name, email. A header row (&quot;Full name,Email&quot;)
            is optional and detected automatically.
          </p>

          {importRows.length > 0 && (
            <div className="mt-4">
              <p className="text-xs font-bold uppercase tracking-wide text-ink-muted">
                {importRows.filter((r) => !r.problem).length} of {importRows.length} rows ready
              </p>
              <ul className="mt-2 max-h-64 space-y-1 overflow-y-auto text-sm">
                {importRows.map((row, i) => (
                  <li
                    key={i}
                    className={`flex items-center justify-between gap-3 border-b border-line py-1 ${
                      row.problem ? 'text-status-flagged' : 'text-ink'
                    }`}
                  >
                    <span>
                      {row.fullName || <em className="text-ink-faint">(no name)</em>} —{' '}
                      {row.email || <em className="text-ink-faint">(no email)</em>}
                    </span>
                    {row.problem && <span className="text-xs">{row.problem}</span>}
                  </li>
                ))}
              </ul>

              {importError && (
                <p role="alert" className="mt-3 text-sm font-medium text-status-flagged">
                  {importError}
                </p>
              )}

              <button
                type="button"
                className="btn-primary mt-4"
                disabled={importBusy || importRows.every((r) => r.problem)}
                onClick={submitImport}
              >
                {importBusy
                  ? 'Sending…'
                  : `Send ${importRows.filter((r) => !r.problem).length} invite(s)`}
              </button>
            </div>
          )}
        </div>
      )}

      {importNotice && (
        <p className="mt-4 border-l-4 border-brand-primary bg-brand-primary-soft p-3 text-sm font-medium text-brand-secondary">
          {importNotice}
        </p>
      )}

      <div className="mt-5 flex flex-wrap items-end gap-3">
        <div className="min-w-[14rem] flex-1">
          <label htmlFor="employeeSearch" className="field-label">
            Search
          </label>
          <input
            id="employeeSearch"
            className="field"
            placeholder="Name or email"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div>
          <label htmlFor="statusFilter" className="field-label">
            Status
          </label>
          <select
            id="statusFilter"
            className="field text-sm"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
          >
            <option value="all">All</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
        </div>
        <div>
          <label htmlFor="roleFilter" className="field-label">
            Role
          </label>
          <select
            id="roleFilter"
            className="field text-sm"
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value as typeof roleFilter)}
          >
            <option value="all">All</option>
            <option value="employee">Employee</option>
            <option value="hr_admin">HR admin</option>
            <option value="super_admin">Super admin</option>
          </select>
        </div>
        <p className="pb-2 text-xs text-ink-faint">
          {visibleEmployees.length} of {employees.length}
        </p>
      </div>

      {selected.size > 0 && (
        <div className="card mt-3 flex flex-wrap items-center gap-3 p-3">
          <p className="text-sm font-semibold text-ink">{selected.size} selected</p>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => setShowBulkPresent((v) => !v)}
          >
            {showBulkPresent ? 'Cancel' : 'Mark selected present'}
          </button>
          <button
            type="button"
            className="text-xs font-semibold text-ink-faint underline"
            onClick={() => setSelected(new Set())}
          >
            Clear selection
          </button>
        </div>
      )}

      {bulkNotice && (
        <p className="mt-3 border-l-4 border-brand-primary bg-brand-primary-soft p-3 text-sm font-medium text-brand-secondary">
          {bulkNotice}
        </p>
      )}

      {showBulkPresent && selected.size > 0 && (
        <div className="card mt-3 p-4">
          <p className="text-xs font-bold uppercase tracking-wide text-ink-muted">
            Mark {selected.size} employee(s) present
          </p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <label className="field-label text-xs" htmlFor="bulk-in">
                Check in
              </label>
              <input
                id="bulk-in"
                type="datetime-local"
                className="field text-sm"
                value={bulkPresentForm.checkIn}
                max={toLocalInputValue(new Date())}
                onChange={(e) =>
                  setBulkPresentForm((f) => ({ ...f, checkIn: e.target.value }))
                }
              />
            </div>
            <div>
              <label className="field-label text-xs" htmlFor="bulk-out">
                Check out <span className="font-normal text-ink-faint">(optional)</span>
              </label>
              <input
                id="bulk-out"
                type="datetime-local"
                className="field text-sm"
                value={bulkPresentForm.checkOut}
                min={bulkPresentForm.checkIn}
                max={toLocalInputValue(new Date())}
                onChange={(e) =>
                  setBulkPresentForm((f) => ({ ...f, checkOut: e.target.value }))
                }
              />
            </div>
            <div>
              <label className="field-label text-xs" htmlFor="bulk-branch">
                Branch <span className="font-normal text-ink-faint">(optional)</span>
              </label>
              <select
                id="bulk-branch"
                className="field text-sm"
                value={bulkPresentForm.branchId}
                onChange={(e) =>
                  setBulkPresentForm((f) => ({ ...f, branchId: e.target.value }))
                }
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
              <label className="field-label text-xs" htmlFor="bulk-note">
                Note <span className="font-normal text-ink-faint">(optional)</span>
              </label>
              <input
                id="bulk-note"
                className="field text-sm"
                maxLength={500}
                value={bulkPresentForm.note}
                onChange={(e) => setBulkPresentForm((f) => ({ ...f, note: e.target.value }))}
              />
            </div>
          </div>
          {bulkError && (
            <p role="alert" className="mt-3 text-sm font-medium text-status-flagged">
              {bulkError}
            </p>
          )}
          <button
            type="button"
            className="btn-primary mt-4"
            disabled={bulkBusy || !bulkPresentForm.checkIn}
            onClick={submitBulkPresent}
          >
            {bulkBusy ? 'Saving…' : `Mark ${selected.size} present`}
          </button>
        </div>
      )}

      <div className="card mt-3 overflow-x-auto">
        <table className="w-full min-w-[48rem] border-collapse text-sm">
          <thead>
            <tr className="border-b border-line text-left">
              <th className="px-4 py-3">
                <span className="sr-only">Select</span>
              </th>
              <Th>Name</Th>
              <Th>Role</Th>
              <Th>Default branch</Th>
              <Th>Weekly off days</Th>
              <Th>Leave balance</Th>
              <Th>Status</Th>
            </tr>
          </thead>
          <tbody>
            {visibleEmployees.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-ink-muted">
                  No employees match this filter.
                </td>
              </tr>
            )}
            {visibleEmployees.map((emp) => {
              const isSelf = emp.id === currentUserId;
              // Role and default-branch changes are super_admin-only; a scoped
              // hr_admin sees the current value as read-only text. Activating/
              // deactivating another administrator is also super_admin-only —
              // "no admin can strip another's access" still holds, just framed
              // around the tier rather than a flat hr_admin/hr_admin check.
              const canEditRoleAndBranch = isSuperAdmin && !isSelf;
              const canToggleActive =
                !isSelf && (isSuperAdmin || emp.role === 'employee');
              // Changing an admin's sign-in email is access-affecting like
              // deactivating one — same restriction, no self-exclusion (the
              // server allows self-edit; only the *other-admin* case is gated).
              const canEditEmail = isSuperAdmin || emp.role === 'employee';
              return (
                <Fragment key={emp.id}>
                <tr className="border-b border-line last:border-0">
                  <td className="px-4 py-3">
                    <input
                      type="checkbox"
                      aria-label={`Select ${emp.full_name}`}
                      checked={selected.has(emp.id)}
                      onChange={() => toggleSelected(emp.id)}
                    />
                  </td>
                  <td className="px-4 py-3">
                    <span className="font-semibold text-ink">
                      {emp.full_name}
                    </span>
                    {isSelf && (
                      <span className="ml-2 text-xs text-ink-faint">(you)</span>
                    )}
                    {!isSelf && emp.role !== 'employee' && (
                      <span
                        className="ml-2 text-xs text-ink-faint"
                        title="Role and access changes for administrators require a super administrator"
                      >
                        ({emp.role === 'super_admin' ? 'super admin' : 'administrator'})
                      </span>
                    )}
                    {editingEmailId === emp.id ? (
                      <div className="mt-1 flex items-center gap-1">
                        <input
                          type="email"
                          aria-label={`Email for ${emp.full_name}`}
                          className="field text-xs"
                          value={emailDraft}
                          disabled={busyId === emp.id}
                          onChange={(e) => setEmailDraft(e.target.value)}
                        />
                        <button
                          type="button"
                          className="text-xs font-semibold text-brand-primary underline"
                          disabled={busyId === emp.id || !emailDraft.trim()}
                          onClick={() => saveEmail(emp.id)}
                        >
                          Save
                        </button>
                        <button
                          type="button"
                          className="text-xs text-ink-faint underline"
                          disabled={busyId === emp.id}
                          onClick={() => setEditingEmailId(null)}
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <span className="block text-xs text-ink-faint">
                        {emp.email}
                        {canEditEmail && (
                          <button
                            type="button"
                            className="ml-2 underline"
                            onClick={() => startEditEmail(emp)}
                          >
                            Change
                          </button>
                        )}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {canEditRoleAndBranch ? (
                      <select
                        aria-label={`Role for ${emp.full_name}`}
                        className="field text-sm"
                        value={emp.role}
                        disabled={busyId === emp.id}
                        onChange={(e) =>
                          update(emp.id, { role: e.target.value as Role })
                        }
                      >
                        <option value="employee">Employee</option>
                        <option value="hr_admin">HR admin</option>
                        <option value="super_admin">Super admin</option>
                      </select>
                    ) : (
                      <span className="text-ink-muted">
                        {ROLE_LABELS[emp.role]}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {canEditRoleAndBranch ? (
                      <>
                        <select
                          aria-label={`Default branch for ${emp.full_name}`}
                          className="field text-sm"
                          value={emp.default_branch_id ?? ''}
                          disabled={busyId === emp.id}
                          onChange={(e) =>
                            update(emp.id, { defaultBranchId: e.target.value })
                          }
                        >
                          <option value="">None</option>
                          {branches.map((b) => (
                            <option key={b.id} value={b.id}>
                              {b.name}
                            </option>
                          ))}
                        </select>
                        <span className="mt-1 block text-xs text-ink-faint">
                          Informational only
                        </span>
                      </>
                    ) : (
                      <span className="text-ink-muted">
                        {branches.find((b) => b.id === emp.default_branch_id)?.name ?? 'None'}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {WEEKDAY_LABELS.map((label, day) => (
                        <button
                          key={day}
                          type="button"
                          aria-label={`Toggle ${label} off for ${emp.full_name}`}
                          disabled={busyId === emp.id}
                          className={`px-1.5 py-0.5 text-[10px] font-semibold ${
                            (emp.weekly_off_days ?? []).includes(day)
                              ? 'bg-brand-primary-soft text-brand-primary'
                              : 'bg-surface-muted text-ink-muted'
                          }`}
                          onClick={() => toggleWeeklyOffDay(emp, day)}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    {emp.weekly_off_days == null ? (
                      <span className="mt-1 block text-xs text-ink-faint">
                        Inherited from branch
                      </span>
                    ) : (
                      <button
                        type="button"
                        className="mt-1 text-xs text-ink-faint underline"
                        disabled={busyId === emp.id}
                        onClick={() => update(emp.id, { weeklyOffDays: null })}
                      >
                        Reset to branch default
                      </button>
                    )}
                    <div className="mt-2 border-t border-line pt-2">
                      <label
                        className="block text-[10px] font-semibold uppercase text-ink-faint"
                        htmlFor={`start-${emp.id}`}
                      >
                        Expected start
                      </label>
                      <input
                        id={`start-${emp.id}`}
                        type="time"
                        className="field mt-0.5 w-24 text-xs"
                        defaultValue={emp.expected_start_time?.slice(0, 5) ?? ''}
                        disabled={busyId === emp.id}
                        onBlur={(e) => {
                          const value = e.target.value || null;
                          const current = emp.expected_start_time?.slice(0, 5) ?? null;
                          if (value !== current) {
                            update(emp.id, { expectedStartTime: value });
                          }
                        }}
                      />
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <input
                      type="number"
                      min={0}
                      step={0.5}
                      aria-label={`Leave balance for ${emp.full_name}`}
                      className="field w-20 text-sm"
                      defaultValue={emp.leave_balance_days}
                      disabled={busyId === emp.id}
                      onBlur={(e) => {
                        const value = Number(e.target.value);
                        if (Number.isFinite(value) && value !== emp.leave_balance_days) {
                          update(emp.id, { leaveBalanceDays: value });
                        }
                      }}
                    />
                    <span className="mt-1 block text-xs text-ink-faint">days / year</span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-col items-start gap-1.5">
                      <button
                        type="button"
                        className={emp.active ? 'btn-danger' : 'btn-secondary'}
                        disabled={busyId === emp.id || !canToggleActive}
                        onClick={() => update(emp.id, { active: !emp.active })}
                      >
                        {emp.active ? 'Deactivate' : 'Reactivate'}
                      </button>
                      <button
                        type="button"
                        className="text-xs font-semibold text-brand-primary underline"
                        onClick={() =>
                          markPresentId === emp.id ? setMarkPresentId(null) : openMarkPresent(emp.id)
                        }
                      >
                        {markPresentId === emp.id ? 'Cancel' : 'Mark present'}
                      </button>
                      <button
                        type="button"
                        className="text-xs font-semibold text-brand-primary underline"
                        onClick={() =>
                          markAbsentId === emp.id ? setMarkAbsentId(null) : openMarkAbsent(emp.id)
                        }
                      >
                        {markAbsentId === emp.id ? 'Cancel' : 'Mark absent'}
                      </button>
                      <button
                        type="button"
                        className="text-xs font-semibold text-brand-primary underline"
                        onClick={() =>
                          markLeaveId === emp.id ? setMarkLeaveId(null) : openMarkLeave(emp.id)
                        }
                      >
                        {markLeaveId === emp.id ? 'Cancel' : 'Mark on leave'}
                      </button>
                      <a
                        href={`/api/hr/employees/${emp.id}/export`}
                        className="text-xs font-semibold text-brand-primary underline"
                        download
                      >
                        Export data
                      </a>
                      {isSuperAdmin && !isSelf && (
                        <button
                          type="button"
                          className="text-xs font-semibold text-status-flagged underline"
                          onClick={() =>
                            deletingId === emp.id ? setDeletingId(null) : openDelete(emp.id)
                          }
                        >
                          {deletingId === emp.id ? 'Cancel' : 'Delete'}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
                {markAbsentId === emp.id && (
                  <tr className="border-b border-line last:border-0">
                    <td colSpan={7} className="bg-surface-muted px-4 py-4">
                      <p className="text-xs font-bold uppercase tracking-wide text-ink-muted">
                        Mark {emp.full_name} absent
                      </p>
                      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end">
                        <div>
                          <label className="field-label text-xs" htmlFor={`ma-date-${emp.id}`}>
                            Date
                          </label>
                          <input
                            id={`ma-date-${emp.id}`}
                            type="date"
                            className="field text-sm"
                            value={markAbsentDate}
                            max={todayInTz()}
                            onChange={(e) => setMarkAbsentDate(e.target.value)}
                          />
                        </div>
                        <button
                          type="button"
                          className="btn-primary"
                          disabled={markAbsentBusy || !markAbsentDate}
                          onClick={() => submitMarkAbsent(emp.id)}
                        >
                          {markAbsentBusy ? 'Saving…' : 'Mark absent'}
                        </button>
                      </div>
                      {markAbsentError && (
                        <p role="alert" className="mt-3 text-sm font-medium text-status-flagged">
                          {markAbsentError}
                        </p>
                      )}
                    </td>
                  </tr>
                )}
                {markLeaveId === emp.id && (
                  <tr className="border-b border-line last:border-0">
                    <td colSpan={7} className="bg-surface-muted px-4 py-4">
                      <p className="text-xs font-bold uppercase tracking-wide text-ink-muted">
                        Record leave for {emp.full_name}
                      </p>
                      <p className="mt-1 text-xs text-ink-faint">
                        Lands directly as approved — for leave already agreed
                        that never went through a request, or a backdated
                        correction.
                      </p>
                      <div className="mt-3 grid gap-3 sm:grid-cols-3">
                        <div>
                          <label className="field-label text-xs" htmlFor={`ml-from-${emp.id}`}>
                            From
                          </label>
                          <input
                            id={`ml-from-${emp.id}`}
                            type="date"
                            className="field text-sm"
                            value={markLeaveForm.fromDate}
                            onChange={(e) =>
                              setMarkLeaveForm((f) => ({ ...f, fromDate: e.target.value }))
                            }
                          />
                        </div>
                        <div>
                          <label className="field-label text-xs" htmlFor={`ml-to-${emp.id}`}>
                            To
                          </label>
                          <input
                            id={`ml-to-${emp.id}`}
                            type="date"
                            className="field text-sm"
                            value={markLeaveForm.toDate}
                            min={markLeaveForm.fromDate}
                            onChange={(e) =>
                              setMarkLeaveForm((f) => ({ ...f, toDate: e.target.value }))
                            }
                          />
                        </div>
                        <div>
                          <label className="field-label text-xs" htmlFor={`ml-reason-${emp.id}`}>
                            Reason
                          </label>
                          <input
                            id={`ml-reason-${emp.id}`}
                            className="field text-sm"
                            maxLength={500}
                            value={markLeaveForm.reason}
                            onChange={(e) =>
                              setMarkLeaveForm((f) => ({ ...f, reason: e.target.value }))
                            }
                          />
                        </div>
                      </div>
                      {markLeaveError && (
                        <p role="alert" className="mt-3 text-sm font-medium text-status-flagged">
                          {markLeaveError}
                        </p>
                      )}
                      <button
                        type="button"
                        className="btn-primary mt-4"
                        disabled={
                          markLeaveBusy ||
                          !markLeaveForm.fromDate ||
                          !markLeaveForm.toDate ||
                          !markLeaveForm.reason.trim()
                        }
                        onClick={() => submitMarkLeave(emp.id)}
                      >
                        {markLeaveBusy ? 'Saving…' : 'Record leave'}
                      </button>
                    </td>
                  </tr>
                )}
                {deletingId === emp.id && (
                  <tr className="border-b border-line last:border-0">
                    <td colSpan={7} className="bg-status-flagged-bg px-4 py-4">
                      <p className="text-sm font-bold text-status-flagged">
                        Permanently delete {emp.full_name}?
                      </p>
                      <p className="mt-1 text-xs text-ink-muted">
                        This cannot be undone. Every attendance record, leave
                        request, absence, and notification tied to this
                        person is deleted along with their account — only a
                        trace in the audit log survives. If you just need to
                        block sign-in, use Deactivate instead.{' '}
                        <a
                          href={`/api/hr/employees/${emp.id}/export`}
                          className="font-semibold underline"
                          download
                        >
                          Export their data first
                        </a>{' '}
                        if you need a copy for your records.
                      </p>
                      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end">
                        <div>
                          <label className="field-label text-xs" htmlFor={`del-confirm-${emp.id}`}>
                            Type <span className="font-mono">{emp.email}</span> to confirm
                          </label>
                          <input
                            id={`del-confirm-${emp.id}`}
                            className="field text-sm"
                            value={deleteConfirmText}
                            disabled={deleteBusy}
                            onChange={(e) => setDeleteConfirmText(e.target.value)}
                          />
                        </div>
                        <button
                          type="button"
                          className="btn-danger"
                          disabled={
                            deleteBusy ||
                            deleteConfirmText.trim().toLowerCase() !== emp.email.toLowerCase()
                          }
                          onClick={() => confirmDelete(emp)}
                        >
                          {deleteBusy ? 'Deleting…' : 'Permanently delete'}
                        </button>
                      </div>
                      {deleteError && (
                        <p role="alert" className="mt-3 text-sm font-medium text-status-flagged">
                          {deleteError}
                        </p>
                      )}
                    </td>
                  </tr>
                )}
                {markPresentId === emp.id && (
                  <tr className="border-b border-line last:border-0">
                    <td colSpan={7} className="bg-surface-muted px-4 py-4">
                      <p className="text-xs font-bold uppercase tracking-wide text-ink-muted">
                        Mark {emp.full_name} present
                      </p>
                      <p className="mt-1 text-xs text-ink-faint">
                        Lands directly as approved — for a phone with no
                        signal, a paper sign-in, or any correction where
                        nothing was ever submitted.
                      </p>
                      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                        <div>
                          <label className="field-label text-xs" htmlFor={`mp-in-${emp.id}`}>
                            Check in
                          </label>
                          <input
                            id={`mp-in-${emp.id}`}
                            type="datetime-local"
                            className="field text-sm"
                            value={markPresentForm.checkIn}
                            max={toLocalInputValue(new Date())}
                            onChange={(e) =>
                              setMarkPresentForm((f) => ({ ...f, checkIn: e.target.value }))
                            }
                          />
                        </div>
                        <div>
                          <label className="field-label text-xs" htmlFor={`mp-out-${emp.id}`}>
                            Check out{' '}
                            <span className="font-normal text-ink-faint">(optional)</span>
                          </label>
                          <input
                            id={`mp-out-${emp.id}`}
                            type="datetime-local"
                            className="field text-sm"
                            value={markPresentForm.checkOut}
                            min={markPresentForm.checkIn}
                            max={toLocalInputValue(new Date())}
                            onChange={(e) =>
                              setMarkPresentForm((f) => ({ ...f, checkOut: e.target.value }))
                            }
                          />
                        </div>
                        <div>
                          <label className="field-label text-xs" htmlFor={`mp-branch-${emp.id}`}>
                            Branch{' '}
                            <span className="font-normal text-ink-faint">(optional)</span>
                          </label>
                          <select
                            id={`mp-branch-${emp.id}`}
                            className="field text-sm"
                            value={markPresentForm.branchId}
                            onChange={(e) =>
                              setMarkPresentForm((f) => ({ ...f, branchId: e.target.value }))
                            }
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
                          <label className="field-label text-xs" htmlFor={`mp-note-${emp.id}`}>
                            Note{' '}
                            <span className="font-normal text-ink-faint">(optional)</span>
                          </label>
                          <input
                            id={`mp-note-${emp.id}`}
                            className="field text-sm"
                            maxLength={500}
                            value={markPresentForm.note}
                            onChange={(e) =>
                              setMarkPresentForm((f) => ({ ...f, note: e.target.value }))
                            }
                          />
                        </div>
                      </div>

                      {markPresentError && (
                        <p
                          role="alert"
                          className="mt-3 border-l-4 border-status-flagged bg-status-flagged-bg p-3 text-sm font-medium text-status-flagged"
                        >
                          {markPresentError}
                        </p>
                      )}

                      <button
                        type="button"
                        className="btn-primary mt-4"
                        disabled={markPresentBusy || !markPresentForm.checkIn}
                        onClick={() => submitMarkPresent(emp.id)}
                      >
                        {markPresentBusy ? 'Saving…' : 'Mark present'}
                      </button>
                    </td>
                  </tr>
                )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {isSuperAdmin && (
        <div className="card mt-5 p-5">
          <h2 className="text-sm font-bold uppercase tracking-wide text-ink-muted">
            HR branch assignments
          </h2>
          <p className="mt-1.5 text-sm text-ink-muted">
            Which branches each HR administrator manages. An HR admin only sees
            and reviews employees whose default branch is assigned to them
            (plus anyone with no default branch).
          </p>

          <div className="mt-4 space-y-4">
            {employees
              .filter((emp) => emp.role === 'hr_admin')
              .map((hrAdmin) => (
                <div key={hrAdmin.id} className="border-t border-line pt-4 first:border-0 first:pt-0">
                  <p className="font-semibold text-ink">{hrAdmin.full_name}</p>
                  <div className="mt-2 flex flex-wrap gap-3">
                    {branches.map((branch) => (
                      <label
                        key={branch.id}
                        className="flex items-center gap-1.5 text-sm text-ink-muted"
                      >
                        <input
                          type="checkbox"
                          checked={(branchSelections[hrAdmin.id] ?? []).includes(branch.id)}
                          onChange={() => toggleBranchSelection(hrAdmin.id, branch.id)}
                        />
                        {branch.name}
                      </label>
                    ))}
                  </div>
                  <button
                    type="button"
                    className="btn-secondary mt-3"
                    disabled={busyId === hrAdmin.id}
                    onClick={() => saveBranches(hrAdmin.id)}
                  >
                    {busyId === hrAdmin.id ? 'Saving…' : 'Save branches'}
                  </button>
                </div>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}

const ROLE_LABELS: Record<Role, string> = {
  employee: 'Employee',
  hr_admin: 'HR admin',
  super_admin: 'Super admin',
};

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="px-4 py-3 text-xs font-bold uppercase tracking-wide text-ink-muted">
      {children}
    </th>
  );
}
