import { NextResponse } from 'next/server';
import { recordAudit } from '@/lib/audit';
import { isEmployeeVisibleTo } from '@/lib/hr-scope';
import { notify } from '@/lib/notify';
import { createAdminClient, getHrUser } from '@/lib/supabase/server';
import type { Employee } from '@/lib/types';

const DATE_SHAPE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * POST /api/hr/absences — HR marks an employee absent for a specific date,
 * without waiting for the nightly job (private.mark_daily_absences()) to get
 * to it — a correction, or a known absence HR wants on the record right away.
 *
 * `unique (employee_id, date)` on public.absences makes this idempotent: if
 * the nightly job (or an earlier call) already marked the date, this is a
 * no-op rather than a conflict.
 */
export async function POST(request: Request) {
  const hr = await getHrUser();
  if (!hr) {
    return NextResponse.json(
      { error: 'HR administrator access required.' },
      { status: 403 },
    );
  }

  let body: { employeeId?: unknown; date?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Malformed request.' }, { status: 400 });
  }

  const employeeId = typeof body.employeeId === 'string' ? body.employeeId : '';
  const date = typeof body.date === 'string' ? body.date : '';

  if (!employeeId) {
    return NextResponse.json({ error: 'employeeId is required.' }, { status: 400 });
  }
  if (!DATE_SHAPE.test(date)) {
    return NextResponse.json({ error: 'A valid date is required.' }, { status: 400 });
  }
  // Today in Asia/Karachi — marking a future date absent is not a fact yet.
  const todayKarachi = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Karachi' }).format(
    new Date(),
  );
  if (date > todayKarachi) {
    return NextResponse.json(
      { error: 'Cannot mark a future date absent.' },
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

  const { error } = await admin
    .from('absences')
    .insert({ employee_id: employeeId, branch_id: target.default_branch_id, date })
    .select('id')
    .single();

  // A unique-violation here just means the date was already marked (the
  // nightly job, most likely) — that is the outcome HR wanted, not a failure.
  if (error && error.code !== '23505') {
    return NextResponse.json(
      { error: 'Could not mark the absence. Please try again.' },
      { status: 500 },
    );
  }

  await recordAudit(admin, hr, {
    action: 'absence.hr_create',
    entityType: 'employee',
    entityId: employeeId,
    subjectId: employeeId,
    detail: { date },
  });

  await notify(admin, [
    {
      recipientId: employeeId,
      kind: 'marked_absent',
      title: `You were marked absent for ${date}`,
      body: `Recorded by ${hr.employee.full_name}.`,
      entityType: 'employee',
      entityId: employeeId,
    },
  ]);

  return NextResponse.json({ employeeId, date, marked: true });
}
