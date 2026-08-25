import { NextResponse } from 'next/server';
import { recordAudit } from '@/lib/audit';
import { isEmployeeVisibleTo } from '@/lib/hr-scope';
import { createAdminClient, getHrUser } from '@/lib/supabase/server';
import type { Employee } from '@/lib/types';

/**
 * GET /api/hr/employees/:id/export — a full data export for one employee,
 * as a downloadable JSON file.
 *
 * For retention/compliance before an offboarding — and pairs directly with
 * DELETE /api/hr/employees, which is irreversible: everything gathered here
 * (attendance, leave, absences, disputes) is exactly what that delete
 * cascades away. Auditing the export itself ('employee.data_exported')
 * because pulling someone's full record is itself a data-access event worth
 * a trail, same reasoning as every other privileged action in this app.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const hr = await getHrUser();
  if (!hr) {
    return NextResponse.json(
      { error: 'HR administrator access required.' },
      { status: 403 },
    );
  }

  const { id } = await params;
  const admin = createAdminClient();

  const { data: target } = await admin
    .from('employees')
    .select('*')
    .eq('id', id)
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

  const [{ data: attendance }, { data: leaveRequests }, { data: absences }, { data: disputes }, { data: auditEntries }] =
    await Promise.all([
      admin.from('attendance').select('*').eq('employee_id', id).order('created_at'),
      admin.from('leave_requests').select('*').eq('employee_id', id).order('created_at'),
      admin.from('absences').select('*').eq('employee_id', id).order('date'),
      admin.from('disputes').select('*').eq('employee_id', id).order('created_at'),
      admin.from('audit_log').select('*').eq('subject_id', id).order('created_at'),
    ]);

  const bundle = {
    exported_at: new Date().toISOString(),
    exported_by: { id: hr.id, name: hr.employee.full_name, email: hr.email },
    employee: target,
    attendance: attendance ?? [],
    leave_requests: leaveRequests ?? [],
    absences: absences ?? [],
    disputes: disputes ?? [],
    audit_log: auditEntries ?? [],
  };

  await recordAudit(admin, hr, {
    action: 'employee.data_exported',
    entityType: 'employee',
    entityId: id,
    subjectId: id,
    detail: {
      counts: {
        attendance: bundle.attendance.length,
        leave_requests: bundle.leave_requests.length,
        absences: bundle.absences.length,
        disputes: bundle.disputes.length,
        audit_log: bundle.audit_log.length,
      },
    },
  });

  const filename = `${target.full_name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-export-${bundle.exported_at.slice(0, 10)}.json`;

  return new NextResponse(JSON.stringify(bundle, null, 2), {
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
