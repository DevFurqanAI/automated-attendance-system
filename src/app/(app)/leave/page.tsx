import type { Metadata } from 'next';
import { StatusBadge } from '@/components/StatusBadge';
import { formatDate } from '@/lib/format';
import { createClient, getSessionUser } from '@/lib/supabase/server';
import type { LeaveRequest } from '@/lib/types';
import { LeaveForm } from './LeaveForm';

export const metadata: Metadata = { title: 'Leave' };

export default async function LeavePage() {
  const user = (await getSessionUser())!;
  const supabase = await createClient();

  const { data: recent } = await supabase
    .from('leave_requests')
    .select('*')
    .eq('employee_id', user.id)
    .order('created_at', { ascending: false })
    .limit(5)
    .returns<LeaveRequest[]>();

  return (
    <div className="mx-auto max-w-xl">
      <h1 className="text-2xl font-bold tracking-tight text-brand-secondary">
        Request leave
      </h1>
      <p className="mt-1.5 text-sm text-ink-muted">
        An HR administrator reviews every request. Approved leave does not
        count as an absence.
      </p>

      <div className="card mt-5 p-5">
        <LeaveForm />
      </div>

      {recent && recent.length > 0 && (
        <section className="mt-8">
          <h2 className="text-sm font-bold uppercase tracking-wide text-ink-muted">
            Your recent requests
          </h2>
          <ul className="mt-3 space-y-2">
            {recent.map((row) => (
              <li key={row.id} className="card p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold text-ink">{row.reason}</p>
                    <p className="mt-1 text-sm text-ink-muted">
                      {formatDate(row.from_date)}
                      {row.to_date !== row.from_date ? ` → ${formatDate(row.to_date)}` : ''}
                    </p>
                  </div>
                  <StatusBadge status={row.status} />
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
