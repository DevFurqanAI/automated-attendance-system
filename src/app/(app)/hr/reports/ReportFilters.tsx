'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { Branch, Employee } from '@/lib/types';

export function ReportFilters({
  employees,
  branches,
  from,
  to,
  employeeId,
  branchId,
  exportHref,
}: {
  employees: Employee[];
  branches: Branch[];
  from: string;
  to: string;
  employeeId: string;
  branchId: string;
  exportHref: string;
}) {
  const router = useRouter();
  const [state, setState] = useState({ from, to, employeeId, branchId });

  function apply(e: React.FormEvent) {
    e.preventDefault();
    const params = new URLSearchParams();
    params.set('from', state.from);
    params.set('to', state.to);
    if (state.employeeId) params.set('employeeId', state.employeeId);
    if (state.branchId) params.set('branchId', state.branchId);
    router.push(`/hr/reports?${params.toString()}`);
  }

  const set = (key: keyof typeof state) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setState((s) => ({ ...s, [key]: e.target.value }));

  return (
    <form onSubmit={apply} className="card mt-5 p-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <label htmlFor="from" className="field-label text-xs">
            From
          </label>
          <input
            id="from"
            type="date"
            className="field text-sm"
            value={state.from}
            onChange={set('from')}
            required
          />
        </div>
        <div>
          <label htmlFor="to" className="field-label text-xs">
            To
          </label>
          <input
            id="to"
            type="date"
            className="field text-sm"
            value={state.to}
            onChange={set('to')}
            required
          />
        </div>
        <div>
          <label htmlFor="employeeId" className="field-label text-xs">
            Employee
          </label>
          <select
            id="employeeId"
            className="field text-sm"
            value={state.employeeId}
            onChange={set('employeeId')}
          >
            <option value="">All employees</option>
            {employees.map((e) => (
              <option key={e.id} value={e.id}>
                {e.full_name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="branchId" className="field-label text-xs">
            Branch
          </label>
          <select
            id="branchId"
            className="field text-sm"
            value={state.branchId}
            onChange={set('branchId')}
          >
            <option value="">All branches</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        <button type="submit" className="btn-primary sm:w-40">
          Apply filters
        </button>
        {/*
          A plain link, not fetch(): the browser handles the
          Content-Disposition download natively and the session cookie rides
          along automatically.
        */}
        <a href={exportHref} className="btn-secondary sm:w-40" download>
          Export CSV
        </a>
      </div>
    </form>
  );
}
