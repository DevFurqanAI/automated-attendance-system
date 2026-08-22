import { NextResponse } from 'next/server';
import { loadReport, toCsv } from '@/lib/attendance/report';
import { createAdminClient, getHrUser } from '@/lib/supabase/server';

/**
 * GET /api/hr/reports?from=&to=&employeeId=&branchId=&format=csv
 *
 * Streams the monthly attendance report as a CSV download (spec §7.6).
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

  if (!from || !to || Number.isNaN(Date.parse(from)) || Number.isNaN(Date.parse(to))) {
    return NextResponse.json(
      { error: 'Both `from` and `to` dates are required.' },
      { status: 400 },
    );
  }

  const { entries } = await loadReport(createAdminClient(), {
    from,
    to,
    employeeId: params.get('employeeId'),
    branchId: params.get('branchId'),
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
