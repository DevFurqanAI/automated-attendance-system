'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { Branch } from '@/lib/types';

export function AnalyticsFilters({
  branches,
  from,
  to,
  branchId,
}: {
  branches: Branch[];
  from: string;
  to: string;
  branchId: string;
}) {
  const router = useRouter();
  const [state, setState] = useState({ from, to, branchId });

  function apply(e: React.FormEvent) {
    e.preventDefault();
    const params = new URLSearchParams({ from: state.from, to: state.to });
    if (state.branchId) params.set('branchId', state.branchId);
    router.push(`/hr/analytics?${params.toString()}`);
  }

  const set =
    (key: keyof typeof state) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setState((s) => ({ ...s, [key]: e.target.value }));

  return (
    <form onSubmit={apply} className="card mt-5 flex flex-wrap items-end gap-3 p-4">
      <div>
        <label htmlFor="from" className="field-label text-xs">
          From
        </label>
        <input id="from" type="date" className="field text-sm" value={state.from} onChange={set('from')} />
      </div>
      <div>
        <label htmlFor="to" className="field-label text-xs">
          To
        </label>
        <input id="to" type="date" className="field text-sm" value={state.to} onChange={set('to')} />
      </div>
      <div>
        <label htmlFor="branchId" className="field-label text-xs">
          Branch
        </label>
        <select id="branchId" className="field text-sm" value={state.branchId} onChange={set('branchId')}>
          <option value="">All branches</option>
          {branches.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
      </div>
      <button type="submit" className="btn-primary">
        Apply
      </button>
    </form>
  );
}
