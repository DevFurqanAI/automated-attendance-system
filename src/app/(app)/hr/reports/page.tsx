import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { loadAttendanceSummary, loadReport } from '@/lib/attendance/report';
import { formatDateTime, formatDuration } from '@/lib/format';
import { createClient, getHrUser } from '@/lib/supabase/server';
import { METHOD_LABELS, type Branch, type Employee } from '@/lib/types';
import { ReportFilters } from './ReportFilters';

export const metadata: Metadata = { title: 'Reports' };

/** Defaults to the current calendar month. */
function defaultRange() {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), 1);
  const to = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
  return { from: from.toISOString(), to: to.toISOString() };
}

function isoDay(value: string | undefined, fallback: string, endOfDay = false) {
  if (!value) return fallback;
  const d = new Date(endOfDay ? `${value}T23:59:59.999` : `${value}T00:00:00`);
  return Number.isNaN(d.getTime()) ? fallback : d.toISOString();
}

export default async function ReportsPage({
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
  const from = isoDay(one('from'), fallback.from);
  const to = isoDay(one('to'), fallback.to, true);
  const employeeId = one('employeeId') || null;
  const branchId = one('branchId') || null;

  const supabase = await createClient();

  const [{ data: employees }, { data: branches }, report, summary] = await Promise.all([
    supabase
      .from('employees')
      .select('*')
      .order('full_name')
      .returns<Employee[]>(),
    supabase
      .from('branches_public')
      .select('*')
      .order('name')
      .returns<Branch[]>(),
    loadReport(supabase, { from, to, employeeId, branchId }),
    loadAttendanceSummary(supabase, { from, to, employeeId, branchId }),
  ]);

  const query = new URLSearchParams({ from, to });
  if (employeeId) query.set('employeeId', employeeId);
  if (branchId) query.set('branchId', branchId);

  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight text-brand-secondary">
        Attendance report
      </h1>
      <p className="mt-1.5 text-sm text-ink-muted">
        Approved records only, using HR-verified times. Pending and declined
        requests are never counted.
      </p>

      <ReportFilters
        employees={employees ?? []}
        branches={branches ?? []}
        from={from.slice(0, 10)}
        to={to.slice(0, 10)}
        employeeId={employeeId ?? ''}
        branchId={branchId ?? ''}
        exportHref={`/api/hr/reports?${query.toString()}`}
      />

      <div className="mt-5 grid gap-3 sm:grid-cols-3">
        <Stat label="Entries" value={String(report.totals.entries)} />
        <Stat label="Total hours" value={formatDuration(report.totals.hours)} />
        <Stat
          label="Still open"
          value={String(report.totals.openShifts)}
          hint="Checked in, not yet out"
        />
      </div>

      {summary.length > 0 && (
        <div className="card mt-5 overflow-x-auto">
          <table className="w-full min-w-[40rem] border-collapse text-sm">
            <thead>
              <tr className="border-b border-line text-left">
                <Th>Employee</Th>
                <Th>Present</Th>
                <Th>Absent</Th>
                <Th>Leave</Th>
                <Th>Off / holiday</Th>
              </tr>
            </thead>
            <tbody>
              {summary.map((row) => (
                <tr key={row.employeeId} className="border-b border-line last:border-0">
                  <td className="px-4 py-3 font-semibold text-ink">{row.employeeName}</td>
                  <td className="px-4 py-3 tabular-nums">{row.present}</td>
                  <td className="px-4 py-3 tabular-nums">{row.absent}</td>
                  <td className="px-4 py-3 tabular-nums">{row.leave}</td>
                  <td className="px-4 py-3 tabular-nums">{row.holidayOrOff}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {report.entries.length === 0 ? (
        <p className="card mt-5 p-10 text-center text-ink-muted">
          No approved attendance in this range.
        </p>
      ) : (
        <div className="card mt-5 overflow-x-auto">
          <table className="w-full min-w-[52rem] border-collapse text-sm">
            <thead>
              <tr className="border-b border-line text-left">
                <Th>Employee</Th>
                <Th>Branch</Th>
                <Th>Check in</Th>
                <Th>Check out</Th>
                <Th>Hours</Th>
                <Th>Method</Th>
              </tr>
            </thead>
            <tbody>
              {report.entries.map((e) => (
                <tr key={e.id} className="border-b border-line last:border-0">
                  <td className="px-4 py-3">
                    <span className="font-semibold text-ink">{e.employeeName}</span>
                    <span className="block text-xs text-ink-faint">
                      {e.employeeEmail}
                    </span>
                  </td>
                  <td className="px-4 py-3">{e.branchName}</td>
                  <td className="px-4 py-3">{formatDateTime(e.checkInTime)}</td>
                  <td className="px-4 py-3">{formatDateTime(e.checkOutTime)}</td>
                  <td className="px-4 py-3 tabular-nums">
                    {formatDuration(e.hours)}
                  </td>
                  <td className="px-4 py-3">
                    {METHOD_LABELS[e.method]}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="card p-4">
      <p className="text-xs font-bold uppercase tracking-wide text-ink-muted">
        {label}
      </p>
      <p className="mt-1 text-2xl font-bold tabular-nums text-brand-secondary">
        {value}
      </p>
      {hint && <p className="mt-0.5 text-xs text-ink-faint">{hint}</p>}
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
