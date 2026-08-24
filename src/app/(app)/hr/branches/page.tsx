import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { createClient, getHrUser } from '@/lib/supabase/server';
import type { Branch, BranchCalendarDay } from '@/lib/types';
import { BranchManager } from './BranchManager';

export const metadata: Metadata = { title: 'Branches' };

export default async function BranchesPage() {
  const hr = await getHrUser();
  if (!hr) redirect('/');

  const supabase = await createClient();

  const [{ data: branches }, { data: calendarDays }, { data: assignments }] = await Promise.all([
    supabase.from('branches_public').select('*').order('name').returns<Branch[]>(),
    supabase
      .from('branch_calendar_days')
      .select('*')
      .order('date')
      .returns<BranchCalendarDay[]>(),
    hr.employee.role === 'super_admin'
      ? Promise.resolve({ data: null })
      : supabase
          .from('hr_branch_assignments')
          .select('branch_id')
          .eq('hr_admin_id', hr.id)
          .returns<{ branch_id: string }[]>(),
  ]);

  const manageableBranchIds =
    hr.employee.role === 'super_admin'
      ? new Set((branches ?? []).map((b) => b.id))
      : new Set((assignments ?? []).map((a) => a.branch_id));

  return (
    <BranchManager
      initialBranches={branches ?? []}
      calendarDays={calendarDays ?? []}
      manageableBranchIds={manageableBranchIds}
      canCreate={hr.employee.role === 'super_admin'}
    />
  );
}
