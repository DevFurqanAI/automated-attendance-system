import { NextResponse } from 'next/server';
import { recordAudit } from '@/lib/audit';
import { isEmployeeVisibleTo } from '@/lib/hr-scope';
import { notify } from '@/lib/notify';
import { createAdminClient, getHrUser } from '@/lib/supabase/server';
import type { Employee, LeaveRequest } from '@/lib/types';

/**
 * POST /api/hr/leave/review — approve or decline a leave request.
 *
 * On approval, any `absences` row already marked for a date inside the
 * approved range is deleted — the nightly job ran before this approval
 * landed, and the employee turns out not to have been absent after all. See
 * "Late reversal" in the design doc.
 */
export async function POST(request: Request) {
  const hr = await getHrUser();
  if (!hr) {
    return NextResponse.json(
      { error: 'HR administrator access required.' },
      { status: 403 },
    );
  }

  let body: { id?: unknown; action?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Malformed request.' }, { status: 400 });
  }

  const id = typeof body.id === 'string' ? body.id : '';
  const action = body.action;

  if (!id) {
    return NextResponse.json({ error: 'Missing request id.' }, { status: 400 });
  }
  if (action !== 'approve' && action !== 'decline') {
    return NextResponse.json(
      { error: 'Action must be "approve" or "decline".' },
      { status: 400 },
    );
  }

  const admin = createAdminClient();

  const { data: record } = await admin
    .from('leave_requests')
    .select('*')
    .eq('id', id)
    .single<LeaveRequest>();

  if (!record) {
    return NextResponse.json({ error: 'Request not found.' }, { status: 404 });
  }
  if (record.status !== 'pending') {
    return NextResponse.json(
      { error: `This request has already been ${record.status}.` },
      { status: 409 },
    );
  }

  const { data: employee } = await admin
    .from('employees')
    .select('default_branch_id')
    .eq('id', record.employee_id)
    .single<Pick<Employee, 'default_branch_id'>>();

  if (!employee || !(await isEmployeeVisibleTo(admin, hr, employee))) {
    return NextResponse.json(
      { error: 'This employee is not in one of your assigned branches.' },
      { status: 403 },
    );
  }

  const reviewedAt = new Date().toISOString();
  const status = action === 'approve' ? 'approved' : 'declined';

  const { error } = await admin
    .from('leave_requests')
    .update({ status, reviewed_by: hr.id, reviewed_at: reviewedAt })
    .eq('id', id);

  if (error) {
    return NextResponse.json(
      { error: `Could not ${action} the request.` },
      { status: 500 },
    );
  }

  await recordAudit(admin, hr, {
    action: action === 'approve' ? 'leave.approve' : 'leave.decline',
    entityType: 'leave_request',
    entityId: id,
    subjectId: record.employee_id,
    detail: { from_date: record.from_date, to_date: record.to_date },
  });

  if (status === 'approved') {
    const { data: reversed } = await admin
      .from('absences')
      .delete()
      .eq('employee_id', record.employee_id)
      .gte('date', record.from_date)
      .lte('date', record.to_date)
      .select('date');

    if (reversed && reversed.length > 0) {
      await recordAudit(admin, hr, {
        action: 'absence.reversed',
        entityType: 'leave_request',
        entityId: id,
        subjectId: record.employee_id,
        detail: { dates: reversed.map((r) => r.date) },
      });
    }
  }

  await notify(admin, [
    {
      recipientId: record.employee_id,
      kind: status === 'approved' ? 'leave_approved' : 'leave_declined',
      title: `Your leave request was ${status}`,
      body: `${record.from_date} → ${record.to_date}. Reviewed by ${hr.employee.full_name}.`,
      entityType: 'leave_request',
      entityId: id,
    },
  ]);

  return NextResponse.json({ id, status });
}
