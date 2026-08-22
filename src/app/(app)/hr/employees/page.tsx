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

  const [{ data: employees }, { data: branches }] = await Promise.all([
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
  ]);

  return (
    <EmployeeManager
      employees={employees ?? []}
      branches={branches ?? []}
      currentUserId={hr.id}
    />
  );
}
