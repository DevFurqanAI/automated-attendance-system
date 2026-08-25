import { NextResponse } from 'next/server';
import { loadReport, toCsv } from '@/lib/attendance/report';
import { isBranchManagedBy, isEmployeeVisibleTo, visibleEmployeeIdsForScoped } from '@/lib/hr-scope';
import { createAdminClient, getHrUser } from '@/lib/supabase/server';
import type { Employee } from '@/lib/types';

/**
 * GET /api/hr/reports?from=&to=&employeeId=&branchId=&format=csv
 *
 * Streams the monthly attendance report as a CSV download (spec §7.6).
 *
 * Reads through the service-role client, which bypasses RLS entirely — unlike
 * the on-screen report (src/app/(app)/hr/reports/page.tsx), which reads with
 * the caller's own session client and is scoped by RLS automatically. This
 * route must therefore re-check branch scoping in code, the same reason every
 * other HR write route does (see src/lib/hr-scope.ts); skipping it would let a
 * scoped hr_admin export attendance data for branches never assigned to them
 * just by passing a different `branchId`/`employeeId`, or none at all.
 */
export async function GET(request: Request) {
  const hr = await getHrUser();
  if (!hr) {
    return NextResponse.json(
      { error: 'HR administrator access required.' },
      { status: 403 },
    );
  }

  const params = new URL(request.url).searchParams;
  const from = params.get('from');
  const to = params.get('to');
  const employeeId = params.get('employeeId');
  const branchId = params.get('branchId');

  if (!from || !to || Number.isNaN(Date.parse(from)) || Number.isNaN(Date.parse(to))) {
    return NextResponse.json(
      { error: 'Both `from` and `to` dates are required.' },
      { status: 400 },
    );
  }

  const admin = createAdminClient();

  if (hr.employee.role !== 'super_admin') {
    if (branchId && !(await isBranchManagedBy(admin, hr, branchId))) {
      return NextResponse.json(
        { error: 'This branch is not assigned to you.' },
        { status: 403 },
      );
    }
    if (employeeId) {
      const { data: target } = await admin
        .from('employees')
        .select('default_branch_id')
        .eq('id', employeeId)
        .single<Pick<Employee, 'default_branch_id'>>();

      if (!target || !(await isEmployeeVisibleTo(admin, hr, target))) {
        return NextResponse.json(
          { error: 'This employee is not in one of your assigned branches.' },
          { status: 403 },
        );
      }
    }
  }

  const employeeIds = await visibleEmployeeIdsForScoped(admin, hr);

  const { entries } = await loadReport(admin, {
    from,
    to,
    employeeId,
    branchId,
    employeeIds,
  });

  // Leading BOM so Excel reads the file as UTF-8 rather than the local
  // codepage, which would mangle non-ASCII names.
  const csv = `﻿${toCsv(entries)}`;
  const filename = `attendance-${from.slice(0, 10)}-to-${to.slice(0, 10)}.csv`;

  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
