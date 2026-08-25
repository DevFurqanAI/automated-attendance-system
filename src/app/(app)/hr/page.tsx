import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { createClient, getHrUser } from '@/lib/supabase/server';
import type { AttendanceRow, Branch, DisputeRow, LeaveRequestRow } from '@/lib/types';
import { ReviewDashboard } from './ReviewDashboard';

export const metadata: Metadata = { title: 'Review' };

export default async function HrReviewPage() {
  const hr = await getHrUser();
  if (!hr) redirect('/');

  const supabase = await createClient();

  const [{ data: records }, { data: leaveRequests }, { data: branches }, { data: disputes }] =
    await Promise.all([
      supabase
        .from('attendance')
        .select(
          '*, employees:employee_id ( id, full_name, email ), branches:branch_id ( id, name ), checkout_branch:check_out_branch_id ( id, name )',
        )
        .in('status', ['pending', 'flagged'])
        .order('submitted_at', { ascending: false })
        .returns<AttendanceRow[]>(),
      supabase
        .from('leave_requests')
        .select('*, employees:employee_id ( id, full_name, email )')
        .eq('status', 'pending')
        .order('created_at', { ascending: false })
        .returns<LeaveRequestRow[]>(),
      supabase
        .from('branches_public')
        .select('*')
        .order('name')
        .returns<Branch[]>(),
      supabase
        .from('disputes')
        .select(
          '*, employees:employee_id ( id, full_name, email ), attendance:attendance_id ( id, method, status, check_in_time, check_out_time )',
        )
        .eq('status', 'open')
        .order('created_at', { ascending: false })
        .returns<DisputeRow[]>(),
    ]);

  return (
    <ReviewDashboard
      initialRecords={records ?? []}
      initialLeaveRequests={leaveRequests ?? []}
      initialDisputes={disputes ?? []}
      branches={branches ?? []}
      currentUserId={hr.id}
    />
  );
}
