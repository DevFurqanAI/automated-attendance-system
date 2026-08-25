import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { loadBranchHours, loadDailyTrend } from '@/lib/attendance/report';
import { createClient, getHrUser } from '@/lib/supabase/server';
import type { Branch } from '@/lib/types';
import { BranchHoursChart, DailyTrendChart } from './AnalyticsCharts';
import { AnalyticsFilters } from './AnalyticsFilters';

export const metadata: Metadata = { title: 'Analytics' };

/** Defaults to the last 30 days. */
function defaultRange() {
  const to = new Date();
  const from = new Date(to);
  from.setDate(from.getDate() - 29);
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const hr = await getHrUser();
  if (!hr) redirect('/');

  const params = await searchParams;
  const one = (k: string) => {
    const v = params[k];
    return Array.isArray(v) ? v[0] : v;
  };

  const fallback = defaultRange();
  const from = one('from') || fallback.from;
  const to = one('to') || fallback.to;
  const branchId = one('branchId') || null;

  const supabase = await createClient();

  const [{ data: branches }, trend, branchHours] = await Promise.all([
    supabase.from('branches_public').select('*').order('name').returns<Branch[]>(),
    loadDailyTrend(supabase, { from: `${from}T00:00:00.000Z`, to: `${to}T23:59:59.999Z`, branchId }),
    loadBranchHours(supabase, { from: `${from}T00:00:00.000Z`, to: `${to}T23:59:59.999Z` }),
  ]);

  const totals = trend.reduce(
    (acc, p) => ({
      present: acc.present + p.present,
      absent: acc.absent + p.absent,
      leave: acc.leave + p.leave,
    }),
    { present: 0, absent: 0, leave: 0 },
  );

  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight text-brand-secondary">Analytics</h1>
      <p className="mt-1.5 text-sm text-ink-muted">
        Attendance trends across the selected range. Approved records only.
      </p>

      <AnalyticsFilters branches={branches ?? []} from={from} to={to} branchId={branchId ?? ''} />

      <div className="mt-5 grid gap-3 sm:grid-cols-3">
        <Stat label="Present (sum)" value={String(totals.present)} />
        <Stat label="Absent (sum)" value={String(totals.absent)} />
        <Stat label="Leave (sum)" value={String(totals.leave)} />
      </div>

      <div className="mt-5">
        <DailyTrendChart points={trend} />
      </div>

      <div className="mt-5">
        <BranchHoursChart rows={branchHours} />
        <p className="mt-2 text-xs text-ink-faint">
          The leave count above is company-wide even when a branch filter is
          applied — leave requests aren&apos;t tied to a branch.
        </p>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="card p-4">
      <p className="text-xs font-bold uppercase tracking-wide text-ink-muted">{label}</p>
      <p className="mt-1 text-2xl font-bold tabular-nums text-brand-secondary">{value}</p>
    </div>
  );
}
