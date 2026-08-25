import type { Metadata } from 'next';
import { todayInTz, totalLeaveDaysInYear } from '@/lib/attendance/leave';
import { createClient, getSessionUser } from '@/lib/supabase/server';
import type { LeaveRequest } from '@/lib/types';
import { LeaveForm } from './LeaveForm';
import { RecentLeaveRequests } from './RecentLeaveRequests';

export const metadata: Metadata = { title: 'Leave' };

export default async function LeavePage() {
  const user = (await getSessionUser())!;
  const supabase = await createClient();

  const year = Number(todayInTz().slice(0, 4));
  const yearStart = `${year}-01-01`;
  const yearEnd = `${year}-12-31`;

  const [{ data: recent }, { data: approvedThisYear }] = await Promise.all([
    supabase
      .from('leave_requests')
      .select('*')
      .eq('employee_id', user.id)
      .order('created_at', { ascending: false })
      .limit(5)
      .returns<LeaveRequest[]>(),
    supabase
      .from('leave_requests')
      .select('from_date, to_date')
      .eq('employee_id', user.id)
      .eq('status', 'approved')
      .lte('from_date', yearEnd)
      .gte('to_date', yearStart)
      .returns<{ from_date: string; to_date: string }[]>(),
  ]);

  const used = totalLeaveDaysInYear(approvedThisYear ?? [], year);
  const balance = user.employee.leave_balance_days;

  return (
    <div className="mx-auto max-w-xl">
      <h1 className="text-2xl font-bold tracking-tight text-brand-secondary">
        Request leave
      </h1>
      <p className="mt-1.5 text-sm text-ink-muted">
        An HR administrator reviews every request. Approved leave does not
        count as an absence.
      </p>

      <div className="card mt-4 p-4">
        <p className="text-xs font-bold uppercase tracking-wide text-ink-muted">
          {year} leave balance
        </p>
        <p className="mt-1 text-lg font-bold text-brand-secondary">
          {used} of {balance} days used
          <span className="ml-2 text-sm font-normal text-ink-muted">
            ({Math.max(0, balance - used)} remaining)
          </span>
        </p>
        {used > balance && (
          <p className="mt-1 text-xs text-status-flagged">
            Over balance — HR can still approve a request beyond this; it is
            shown for visibility, not enforced.
          </p>
        )}
      </div>

      <div className="card mt-5 p-5">
        <LeaveForm />
      </div>

      <RecentLeaveRequests initialRows={recent ?? []} />
    </div>
  );
}
