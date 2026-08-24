import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { createClient, getHrUser } from '@/lib/supabase/server';
import type { Branch, Employee } from '@/lib/types';
import { EmployeeManager } from './EmployeeManager';

export const metadata: Metadata = { title: 'Employees' };

export default async function EmployeesPage() {
  const hr = await getHrUser();
  if (!hr) redirect('/');

  const supabase = await createClient();

  const [{ data: employees }, { data: branches }, { data: assignments }] = await Promise.all([
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
    supabase
      .from('hr_branch_assignments')
      .select('hr_admin_id, branch_id')
      .returns<{ hr_admin_id: string; branch_id: string }[]>(),
  ]);

  return (
    <EmployeeManager
      employees={employees ?? []}
      branches={branches ?? []}
      currentUserId={hr.id}
      currentUserRole={hr.employee.role}
      branchAssignments={assignments ?? []}
    />
  );
}
