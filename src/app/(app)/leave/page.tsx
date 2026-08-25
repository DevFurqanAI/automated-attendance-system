import type { Metadata } from 'next';
import { createClient, getSessionUser } from '@/lib/supabase/server';
import type { LeaveRequest } from '@/lib/types';
import { LeaveForm } from './LeaveForm';
import { RecentLeaveRequests } from './RecentLeaveRequests';

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

      <RecentLeaveRequests initialRows={recent ?? []} />
    </div>
  );
}
