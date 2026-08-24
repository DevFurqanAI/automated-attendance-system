import { NextResponse } from 'next/server';
import { recordAudit } from '@/lib/audit';
import { createAdminClient, getSuperAdminUser } from '@/lib/supabase/server';

/**
 * POST /api/hr/branch-assignments — replace one HR admin's full set of
 * managed branches. Super-admin only: see "Who assigns HR" in the design doc.
 */
export async function POST(request: Request) {
  const superAdmin = await getSuperAdminUser();
  if (!superAdmin) {
    return NextResponse.json(
      { error: 'Super administrator access required.' },
      { status: 403 },
    );
  }

  let body: { hrAdminId?: unknown; branchIds?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Malformed request.' }, { status: 400 });
  }

  const hrAdminId = typeof body.hrAdminId === 'string' ? body.hrAdminId : '';
  const branchIds = Array.isArray(body.branchIds)
    ? body.branchIds.filter((v): v is string => typeof v === 'string')
    : null;

  if (!hrAdminId || !branchIds) {
    return NextResponse.json(
      { error: 'hrAdminId and branchIds are required.' },
      { status: 400 },
    );
  }

  const admin = createAdminClient();

  const { data: target } = await admin
    .from('employees')
    .select('id, role')
    .eq('id', hrAdminId)
    .single<{ id: string; role: string }>();

  if (!target || target.role !== 'hr_admin') {
    return NextResponse.json(
      { error: 'Target must be an existing hr_admin.' },
      { status: 400 },
    );
  }

  const { error: deleteError } = await admin
    .from('hr_branch_assignments')
    .delete()
    .eq('hr_admin_id', hrAdminId);

  if (deleteError) {
    return NextResponse.json(
      { error: 'Could not update branch assignments.' },
      { status: 500 },
    );
  }

  if (branchIds.length > 0) {
    const { error: insertError } = await admin
      .from('hr_branch_assignments')
      .insert(branchIds.map((branchId) => ({ hr_admin_id: hrAdminId, branch_id: branchId })));

    if (insertError) {
      return NextResponse.json(
        { error: 'Could not update branch assignments.' },
        { status: 500 },
      );
    }
  }

  await recordAudit(admin, superAdmin, {
    action: 'hr.branches_assigned',
    entityType: 'employee',
    entityId: hrAdminId,
    subjectId: hrAdminId,
    detail: { branch_ids: branchIds },
  });

  return NextResponse.json({ hrAdminId, branchIds });
}
