import type { Metadata } from 'next';
import { StatusBadge } from '@/components/StatusBadge';
import { formatDateTime } from '@/lib/format';
import { createClient, getSessionUser } from '@/lib/supabase/server';
import type { Attendance } from '@/lib/types';
import { RemoteForm } from './RemoteForm';

export const metadata: Metadata = { title: 'Remote check-in' };

export default async function RemotePage() {
  const user = (await getSessionUser())!;
  const supabase = await createClient();

  const { data: recent } = await supabase
    .from('attendance')
    .select('*')
    .eq('employee_id', user.id)
    .eq('method', 'remote_request')
    .order('submitted_at', { ascending: false })
    .limit(5)
    .returns<Attendance[]>();

  return (
    <div className="mx-auto max-w-xl">
      <h1 className="text-2xl font-bold tracking-tight text-brand-secondary">
        Remote check-in
      </h1>
      <p className="mt-1.5 text-sm text-ink-muted">
        For work done away from a branch. An HR administrator reviews every
        request — it does not count as attendance until it is approved.
      </p>

      <div className="card mt-5 p-5">
        <RemoteForm />
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
