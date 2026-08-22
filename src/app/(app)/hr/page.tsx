import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { createClient, getHrUser } from '@/lib/supabase/server';
import type { AttendanceRow, Branch } from '@/lib/types';
import { ReviewDashboard } from './ReviewDashboard';

export const metadata: Metadata = { title: 'Review' };

export default async function HrReviewPage() {
  const hr = await getHrUser();
  if (!hr) redirect('/');

  const supabase = await createClient();

  const [{ data: records }, { data: branches }] = await Promise.all([
    supabase
      .from('attendance')
      .select(
        '*, employees:employee_id ( id, full_name, email ), branches:branch_id ( id, name )',
      )
      .in('status', ['pending', 'flagged'])
      .order('submitted_at', { ascending: false })
      .returns<AttendanceRow[]>(),
    supabase
      .from('branches_public')
      .select('*')
      .order('name')
      .returns<Branch[]>(),
  ]);

  return (
    <ReviewDashboard
      initialRecords={records ?? []}
      branches={branches ?? []}
    />
  );
}
