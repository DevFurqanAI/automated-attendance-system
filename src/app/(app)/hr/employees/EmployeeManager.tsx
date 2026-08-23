'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { Branch, Employee, Role } from '@/lib/types';

export function EmployeeManager({
  employees,
  branches,
  currentUserId,
}: {
  employees: Employee[];
  branches: Branch[];
  currentUserId: string;
}) {
  const router = useRouter();
  const [showInvite, setShowInvite] = useState(false);
  const [invite, setInvite] = useState({ fullName: '', email: '' });
  const [busyId, setBusyId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

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
              <Th>Status</Th>
            </tr>
          </thead>
          <tbody>
            {employees.map((emp) => {
              const isSelf = emp.id === currentUserId;
              // One administrator may not strip another's access — the API
              // refuses it, so the controls say so up front rather than letting
              // the click fail. Removing an admin is out-of-band:
              // `npm run db:set-role -- <email> employee`.
              const isOtherAdmin = !isSelf && emp.role === 'hr_admin';
              const locked = isSelf || isOtherAdmin;
              return (
                <tr key={emp.id} className="border-b border-line last:border-0">
                  <td className="px-4 py-3">
                    <span className="font-semibold text-ink">
                      {emp.full_name}
                    </span>
                    {isSelf && (
                      <span className="ml-2 text-xs text-ink-faint">(you)</span>
                    )}
                    {isOtherAdmin && (
                      <span
                        className="ml-2 text-xs text-ink-faint"
                        title="Administrators can only be demoted with npm run db:set-role"
                      >
                        (administrator)
                      </span>
                    )}
                    <span className="block text-xs text-ink-faint">
                      {emp.email}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <select
                      aria-label={`Role for ${emp.full_name}`}
                      className="field text-sm"
                      value={emp.role}
                      disabled={busyId === emp.id || locked}
                      onChange={(e) =>
                        update(emp.id, { role: e.target.value as Role })
                      }
                    >
                      <option value="employee">Employee</option>
                      <option value="hr_admin">HR admin</option>
                    </select>
                  </td>
                  <td className="px-4 py-3">
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
                  </td>
                  <td className="px-4 py-3">
                    <button
                      type="button"
                      className={emp.active ? 'btn-danger' : 'btn-secondary'}
                      disabled={busyId === emp.id || locked}
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
