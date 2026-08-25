import { NextResponse } from 'next/server';
import { recordAudit } from '@/lib/audit';
import { isEmployeeVisibleTo } from '@/lib/hr-scope';
import { notify } from '@/lib/notify';
import { createAdminClient, getHrUser } from '@/lib/supabase/server';
import type { Dispute, Employee } from '@/lib/types';

/**
 * POST /api/hr/disputes — HR resolves an open dispute.
 *
 * Does not itself change the disputed attendance record — HR corrects that
 * separately via PATCH /api/hr/attendance if the dispute turns out to be
 * warranted, then resolves this with a note explaining what happened (or
 * why nothing changed).
 */
export async function POST(request: Request) {
  const hr = await getHrUser();
  if (!hr) {
    return NextResponse.json(
      { error: 'HR administrator access required.' },
      { status: 403 },
    );
  }

  let body: { id?: unknown; resolutionNote?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Malformed request.' }, { status: 400 });
  }

  const id = typeof body.id === 'string' ? body.id : '';
  const resolutionNote =
    typeof body.resolutionNote === 'string' ? body.resolutionNote.trim().slice(0, 500) : '';

  if (!id) {
    return NextResponse.json({ error: 'Missing dispute id.' }, { status: 400 });
  }

  const admin = createAdminClient();

  const { data: dispute } = await admin
    .from('disputes')
    .select('*')
    .eq('id', id)
    .single<Dispute>();

  if (!dispute) {
    return NextResponse.json({ error: 'Dispute not found.' }, { status: 404 });
  }
  if (dispute.status !== 'open') {
    return NextResponse.json({ error: 'This dispute is already resolved.' }, { status: 409 });
  }

  const { data: target } = await admin
    .from('employees')
    .select('*')
    .eq('id', dispute.employee_id)
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
    .from('disputes')
    .update({
      status: 'resolved',
      resolution_note: resolutionNote || null,
      resolved_by: hr.id,
      resolved_at: new Date().toISOString(),
    })
    .eq('id', id);

  if (error) {
    return NextResponse.json(
      { error: 'Could not resolve the dispute.' },
      { status: 500 },
    );
  }

  await recordAudit(admin, hr, {
    action: 'dispute.resolved',
    entityType: 'attendance',
    entityId: dispute.attendance_id,
    subjectId: dispute.employee_id,
    detail: { dispute_id: id, resolution_note: resolutionNote || null },
  });

  await notify(admin, [
    {
      recipientId: dispute.employee_id,
      kind: 'dispute_resolved',
      title: 'Your attendance dispute was resolved',
      body: resolutionNote
        ? `${resolutionNote} — ${hr.employee.full_name}`
        : `Reviewed by ${hr.employee.full_name}.`,
      entityType: 'attendance',
      entityId: dispute.attendance_id,
    },
  ]);

  return NextResponse.json({ id, status: 'resolved' });
}
