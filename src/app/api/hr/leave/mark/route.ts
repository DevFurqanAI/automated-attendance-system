import { NextResponse } from 'next/server';
import { recordAudit } from '@/lib/audit';
import { isEmployeeVisibleTo } from '@/lib/hr-scope';
import { notify } from '@/lib/notify';
import { createAdminClient, getHrUser } from '@/lib/supabase/server';
import type { Employee } from '@/lib/types';

const DATE_SHAPE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * POST /api/hr/leave/mark — HR records approved leave directly, skipping the
 * employee-submits/HR-approves round trip.
 *
 * For leave HR already knows about and needs on the record right away — a
 * verbal request, a backdated correction — without the two-step dance. Unlike
 * a submitted request, this is not restricted to today-or-future: HR is
 * recording a fact, possibly after it happened, not making a forward-looking
 * request subject to validateLeaveRange's "not in the past" rule.
 *
 * Creates the row pre-approved (reviewed_by/reviewed_at set immediately) and
 * runs the same "late reversal" as a normal approval — deleting any
 * already-marked absences in range — so backdating still corrects the record
 * the nightly job may have already written.
 */
export async function POST(request: Request) {
  const hr = await getHrUser();
  if (!hr) {
    return NextResponse.json(
      { error: 'HR administrator access required.' },
      { status: 403 },
    );
  }

  let body: { employeeId?: unknown; fromDate?: unknown; toDate?: unknown; reason?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Malformed request.' }, { status: 400 });
  }

  const employeeId = typeof body.employeeId === 'string' ? body.employeeId : '';
  const fromDate = typeof body.fromDate === 'string' ? body.fromDate : '';
  const toDate = typeof body.toDate === 'string' ? body.toDate : '';
  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';

  if (!employeeId) {
    return NextResponse.json({ error: 'employeeId is required.' }, { status: 400 });
  }
  if (!DATE_SHAPE.test(fromDate) || !DATE_SHAPE.test(toDate)) {
    return NextResponse.json({ error: 'Valid dates are required.' }, { status: 400 });
  }
  if (toDate < fromDate) {
    return NextResponse.json(
      { error: 'The end date cannot be before the start date.' },
      { status: 400 },
    );
  }
  if (!reason) {
    return NextResponse.json({ error: 'A reason is required.' }, { status: 400 });
  }
  if (reason.length > 500) {
    return NextResponse.json(
      { error: 'Reason must be 500 characters or fewer.' },
      { status: 400 },
    );
  }

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

  const reviewedAt = new Date().toISOString();

  const { data: inserted, error } = await admin
    .from('leave_requests')
    .insert({
      employee_id: employeeId,
      from_date: fromDate,
      to_date: toDate,
      reason,
      status: 'approved',
      reviewed_by: hr.id,
      reviewed_at: reviewedAt,
    })
    .select('id')
    .single();

  if (error) {
    return NextResponse.json(
      { error: 'Could not record the leave. Please try again.' },
      { status: 500 },
    );
  }

  await recordAudit(admin, hr, {
    action: 'leave.hr_mark',
    entityType: 'leave_request',
    entityId: inserted.id,
    subjectId: employeeId,
    detail: { from_date: fromDate, to_date: toDate, reason },
  });

  // Same "late reversal" as a normal approval (src/app/api/hr/leave/review/route.ts)
  // — a backdated entry may cover a date the nightly job already marked absent.
  const { data: reversed } = await admin
    .from('absences')
    .delete()
    .eq('employee_id', employeeId)
    .gte('date', fromDate)
    .lte('date', toDate)
    .select('date');

  if (reversed && reversed.length > 0) {
    await recordAudit(admin, hr, {
      action: 'absence.reversed',
      entityType: 'leave_request',
      entityId: inserted.id,
      subjectId: employeeId,
      detail: { dates: reversed.map((r) => r.date) },
    });
  }

  await notify(admin, [
    {
      recipientId: employeeId,
      kind: 'leave_approved',
      title: 'Leave was recorded for you',
      body: `${fromDate} → ${toDate}. Recorded by ${hr.employee.full_name}: ${reason}`,
      entityType: 'leave_request',
      entityId: inserted.id,
    },
  ]);

  return NextResponse.json({ id: inserted.id, status: 'approved', fromDate, toDate });
}
