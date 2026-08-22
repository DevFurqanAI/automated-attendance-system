import Link from 'next/link';
import { StatusBadge } from '@/components/StatusBadge';
import { formatDateTime } from '@/lib/format';
import { createClient, getSessionUser } from '@/lib/supabase/server';

export default async function HomePage() {
  const user = (await getSessionUser())!;
  const supabase = await createClient();
  const isHr = user.employee.role === 'hr_admin';

  const { data: openRows } = await supabase
    .from('attendance')
    .select('id, check_in_time, status, branches:branch_id ( name )')
    .eq('employee_id', user.id)
    .eq('method', 'qr_gps')
    .in('status', ['approved', 'flagged'])
    .is('check_out_time', null)
    .order('check_in_time', { ascending: false, nullsFirst: false })
    .limit(1);

  const open = openRows?.[0];

  // HR sees the size of the queue waiting for them.
  let queueCount = 0;
  if (isHr) {
    const { count } = await supabase
      .from('attendance')
      .select('id', { count: 'exact', head: true })
      .in('status', ['pending', 'flagged']);
    queueCount = count ?? 0;
  }

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-2xl font-bold tracking-tight text-brand-secondary">
        Hello, {user.employee.full_name.split(' ')[0]}
      </h1>

      <div className="card mt-5 p-5">
        {open ? (
          <>
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-sm font-bold uppercase tracking-wide text-ink-muted">
                Current shift
              </h2>
              <StatusBadge status={open.status as 'approved' | 'flagged'} />
            </div>
            <p className="mt-2 text-lg font-semibold text-brand-secondary">
              Checked in at{' '}
              {(open.branches as unknown as { name: string } | null)?.name ??
                'a branch'}
            </p>
            <p className="mt-0.5 text-sm text-ink-muted">
              Since {formatDateTime(open.check_in_time as string)}
            </p>
            <Link href="/check-in" className="btn-primary mt-4 w-full sm:w-auto">
              Scan to check out
            </Link>
          </>
        ) : (
          <>
            <h2 className="text-sm font-bold uppercase tracking-wide text-ink-muted">
              Not checked in
            </h2>
            <p className="mt-2 text-ink-muted">
              Scan the QR code at your branch entrance to start your shift.
            </p>
            <div className="mt-4 flex flex-col gap-2 sm:flex-row">
              <Link href="/check-in" className="btn-primary">
                Scan to check in
              </Link>
              <Link href="/remote" className="btn-secondary">
                Remote check-in
              </Link>
            </div>
          </>
        )}
      </div>

      {isHr && (
        <div className="card mt-4 p-5">
          <h2 className="text-sm font-bold uppercase tracking-wide text-ink-muted">
            HR review queue
          </h2>
          <p className="mt-2 text-3xl font-bold tabular-nums text-brand-secondary">
            {queueCount}
          </p>
          <p className="mt-0.5 text-sm text-ink-muted">
            {queueCount === 1 ? 'record needs' : 'records need'} your review.
          </p>
          <div className="mt-4 flex flex-col gap-2 sm:flex-row">
            <Link href="/hr" className="btn-primary">
              Open review dashboard
            </Link>
            <Link href="/hr/reports" className="btn-secondary">
              Monthly report
            </Link>
          </div>
        </div>
      )}

      <Link
        href="/history"
        className="mt-4 block text-sm font-semibold text-brand-primary hover:underline"
      >
        View my attendance history →
      </Link>
    </div>
  );
}
