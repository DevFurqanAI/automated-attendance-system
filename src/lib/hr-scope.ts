import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Employee } from '@/lib/types';
import type { SessionUser } from '@/lib/supabase/server';

/**
 * Branch-scope checks for HR write endpoints.
 *
 * Read scoping is enforced by RLS (see the 20260824100000 migration) for any
 * query made with the caller's own session client. These helpers exist for
 * the routes that must write through the service-role client, which bypasses
 * RLS entirely — the same reason every other HR route re-checks permission in
 * code rather than trusting the client (see src/app/api/hr/review/route.ts).
 */

export async function isBranchManagedBy(
  admin: SupabaseClient,
  hr: SessionUser,
  branchId: string,
): Promise<boolean> {
  if (hr.employee.role === 'super_admin') return true;

  const { data } = await admin
    .from('hr_branch_assignments')
    .select('branch_id')
    .eq('hr_admin_id', hr.id)
    .eq('branch_id', branchId)
    .maybeSingle();

  return Boolean(data);
}

export async function isEmployeeVisibleTo(
  admin: SupabaseClient,
  hr: SessionUser,
  employee: Pick<Employee, 'default_branch_id'>,
): Promise<boolean> {
  if (hr.employee.role === 'super_admin') return true;
  if (employee.default_branch_id === null) return true;
  return isBranchManagedBy(admin, hr, employee.default_branch_id);
}
