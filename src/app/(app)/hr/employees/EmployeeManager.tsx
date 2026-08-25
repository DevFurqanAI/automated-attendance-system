'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { WEEKDAY_LABELS, type Branch, type Employee, type Role } from '@/lib/types';

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
        <button
          type="button"
          className="btn-secondary"
          onClick={() => setShowInvite((v) => !v)}
        >
          {showInvite ? 'Cancel' : 'Invite employee'}
        </button>
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

      <div className="card mt-5 overflow-x-auto">
        <table className="w-full min-w-[48rem] border-collapse text-sm">
          <thead>
            <tr className="border-b border-line text-left">
              <Th>Name</Th>
              <Th>Role</Th>
              <Th>Default branch</Th>
              <Th>Weekly off days</Th>
              <Th>Status</Th>
            </tr>
          </thead>
          <tbody>
            {employees.map((emp) => {
              const isSelf = emp.id === currentUserId;
              // Role and default-branch changes are super_admin-only; a scoped
              // hr_admin sees the current value as read-only text. Activating/
              // deactivating another administrator is also super_admin-only —
              // "no admin can strip another's access" still holds, just framed
              // around the tier rather than a flat hr_admin/hr_admin check.
              const canEditRoleAndBranch = isSuperAdmin && !isSelf;
              const canToggleActive =
                !isSelf && (isSuperAdmin || emp.role === 'employee');
              return (
                <tr key={emp.id} className="border-b border-line last:border-0">
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
                    <span className="block text-xs text-ink-faint">
                      {emp.email}
                    </span>
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
                  </td>
                  <td className="px-4 py-3">
                    <button
                      type="button"
                      className={emp.active ? 'btn-danger' : 'btn-secondary'}
                      disabled={busyId === emp.id || !canToggleActive}
                      onClick={() => update(emp.id, { active: !emp.active })}
                    >
                      {emp.active ? 'Deactivate' : 'Reactivate'}
                    </button>
                  </td>
                </tr>
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
