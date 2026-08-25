import { NextResponse } from 'next/server';
import { FUTURE_TOLERANCE_MS } from '@/lib/attendance/remote-claim';
import { recordAudit } from '@/lib/audit';
import { isEmployeeVisibleTo } from '@/lib/hr-scope';
import { notify } from '@/lib/notify';
import { createAdminClient, getHrUser } from '@/lib/supabase/server';
import type { Employee } from '@/lib/types';

/**
 * POST /api/hr/attendance — HR marks an employee present directly.
 *
 * For the cases nothing else covers: a phone with no signal all day, a
 * paper sign-in sheet predating this system, or a plain correction where
 * nothing was ever submitted. Lands directly as `approved` — HR creating the
 * record already IS the authorization, so there is no queue to sit in.
 * Always audited ('attendance.hr_create').
 *
 * Deliberately creation-only, not an edit path for an existing settled
 * record — see the "re-reviewing a settled record" comment in
 * src/app/api/hr/review/route.ts. A correction to something already on the
 * books is a new, superseding entry, not a silent rewrite of history.
 */
export async function POST(request: Request) {
  const hr = await getHrUser();
  if (!hr) {
    return NextResponse.json(
      { error: 'HR administrator access required.' },
      { status: 403 },
    );
  }

  let body: {
    employeeId?: unknown;
    checkInTime?: unknown;
    checkOutTime?: unknown;
    branchId?: unknown;
    note?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Malformed request.' }, { status: 400 });
  }

  const employeeId = typeof body.employeeId === 'string' ? body.employeeId : '';
  if (!employeeId) {
    return NextResponse.json({ error: 'employeeId is required.' }, { status: 400 });
  }

  const checkIn = parseDate(body.checkInTime);
  if (!checkIn) {
    return NextResponse.json(
      { error: 'A valid check-in time is required.' },
      { status: 400 },
    );
  }
  if (checkIn.getTime() > Date.now() + FUTURE_TOLERANCE_MS) {
    return NextResponse.json(
      { error: 'Check-in time cannot be in the future.' },
      { status: 400 },
    );
  }

  let checkOut: Date | null = null;
  if (body.checkOutTime !== undefined && body.checkOutTime !== null && body.checkOutTime !== '') {
    checkOut = parseDate(body.checkOutTime);
    if (!checkOut) {
      return NextResponse.json(
        { error: 'The check-out time is not a valid date.' },
        { status: 400 },
      );
    }
    if (checkOut.getTime() < checkIn.getTime()) {
      return NextResponse.json(
        { error: 'Check-out cannot be before check-in.' },
        { status: 400 },
      );
    }
    if (checkOut.getTime() > Date.now() + FUTURE_TOLERANCE_MS) {
      return NextResponse.json(
        { error: 'Check-out time cannot be in the future.' },
        { status: 400 },
      );
    }
  }

  const branchId =
    typeof body.branchId === 'string' && body.branchId ? body.branchId : null;
  const note = typeof body.note === 'string' ? body.note.trim().slice(0, 500) : '';

  const admin = createAdminClient();

  const { data: target } = await admin
    .from('employees')
    .select('*')
    .eq('id', employeeId)
    .single<Employee>();

  if (!target) {
    return NextResponse.json({ error: 'Employee not found.' }, { status: 404 });
  }
  if (hr.employee.role !== 'super_admin' && !(await isEmployeeVisibleTo(admin, hr, target))) {
    return NextResponse.json(
      { error: 'This employee is not in one of your assigned branches.' },
      { status: 403 },
    );
  }

  const { data: inserted, error } = await admin
    .from('attendance')
    .insert({
      employee_id: employeeId,
      branch_id: branchId,
      check_in_time: checkIn.toISOString(),
      check_out_time: checkOut?.toISOString() ?? null,
      submitted_at: new Date().toISOString(),
      method: 'hr_manual',
      status: 'approved',
      remote_reason: note || null,
      reviewed_by: hr.id,
      reviewed_at: new Date().toISOString(),
    })
    .select('id')
    .single();

  if (error) {
    return NextResponse.json(
      { error: 'Could not create the record. Please try again.' },
      { status: 500 },
    );
  }

  await recordAudit(admin, hr, {
    action: 'attendance.hr_create',
    entityType: 'attendance',
    entityId: inserted.id,
    subjectId: employeeId,
    detail: {
      check_in_time: checkIn.toISOString(),
      check_out_time: checkOut?.toISOString() ?? null,
      branch_id: branchId,
      note: note || null,
    },
  });

  await notify(admin, [
    {
      recipientId: employeeId,
      kind: 'attendance_approved',
      title: 'HR marked you present',
      body:
        `Recorded by ${hr.employee.full_name}${note ? `: ${note}` : '.'}`.trim(),
      entityType: 'attendance',
      entityId: inserted.id,
    },
  ]);

  return NextResponse.json({
    id: inserted.id,
    status: 'approved',
    checkInTime: checkIn.toISOString(),
    checkOutTime: checkOut?.toISOString() ?? null,
  });
}

function parseDate(value: unknown): Date | null {
  if (typeof value !== 'string' || !value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}
