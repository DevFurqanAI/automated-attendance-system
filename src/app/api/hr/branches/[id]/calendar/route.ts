import { NextResponse } from 'next/server';
import { recordAudit } from '@/lib/audit';
import { isBranchManagedBy } from '@/lib/hr-scope';
import { createAdminClient, getHrUser } from '@/lib/supabase/server';

/**
 * POST /api/hr/branches/:id/calendar — declare a holiday or mandatory workday.
 * DELETE /api/hr/branches/:id/calendar?calendarId=... — remove one.
 * Scoped to the calling HR admin's assigned branches (or super_admin).
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const hr = await getHrUser();
  if (!hr) {
    return NextResponse.json({ error: 'HR administrator access required.' }, { status: 403 });
  }

  const { id: branchId } = await params;
  const admin = createAdminClient();

  if (!(await isBranchManagedBy(admin, hr, branchId))) {
    return NextResponse.json({ error: 'This branch is not assigned to you.' }, { status: 403 });
  }

  let body: { date?: unknown; kind?: unknown; label?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Malformed request.' }, { status: 400 });
  }

  const date = typeof body.date === 'string' ? body.date : '';
  const kind = body.kind;
  const label = typeof body.label === 'string' ? body.label.trim().slice(0, 200) : null;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: 'A valid date (YYYY-MM-DD) is required.' }, { status: 400 });
  }
  if (kind !== 'holiday' && kind !== 'mandatory_workday') {
    return NextResponse.json(
      { error: 'kind must be "holiday" or "mandatory_workday".' },
      { status: 400 },
    );
  }

  const { data, error } = await admin
    .from('branch_calendar_days')
    .upsert(
      { branch_id: branchId, date, kind, label },
      { onConflict: 'branch_id,date' },
    )
    .select('id, date, kind, label')
    .single();

  if (error) {
    return NextResponse.json({ error: 'Could not save the calendar day.' }, { status: 500 });
  }

  await recordAudit(admin, hr, {
    action: 'branch.update',
    entityType: 'branch',
    entityId: branchId,
    detail: { calendar_day: data },
  });

  return NextResponse.json(data);
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const hr = await getHrUser();
  if (!hr) {
    return NextResponse.json({ error: 'HR administrator access required.' }, { status: 403 });
  }

  const { id: branchId } = await params;
  const admin = createAdminClient();

  if (!(await isBranchManagedBy(admin, hr, branchId))) {
    return NextResponse.json({ error: 'This branch is not assigned to you.' }, { status: 403 });
  }

  const calendarId = new URL(request.url).searchParams.get('calendarId');
  if (!calendarId) {
    return NextResponse.json({ error: 'Missing calendarId.' }, { status: 400 });
  }

  const { error } = await admin
    .from('branch_calendar_days')
    .delete()
    .eq('id', calendarId)
    .eq('branch_id', branchId);

  if (error) {
    return NextResponse.json({ error: 'Could not remove the calendar day.' }, { status: 500 });
  }

  await recordAudit(admin, hr, {
    action: 'branch.update',
    entityType: 'branch',
    entityId: branchId,
    detail: { calendar_day_removed: calendarId },
  });

  return NextResponse.json({ ok: true });
}
