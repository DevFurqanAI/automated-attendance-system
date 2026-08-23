import { NextResponse } from 'next/server';
import { recordAudit } from '@/lib/audit';
import { notify } from '@/lib/notify';
import { RATE_LIMITS, checkRateLimit, tooManyRequests } from '@/lib/rate-limit';
import { createAdminClient, getHrUser } from '@/lib/supabase/server';
import type { Employee } from '@/lib/types';

/**
 * POST   /api/hr/employees — invite a new staff member.
 * PATCH  /api/hr/employees — change role / active / default branch.
 */
export async function POST(request: Request) {
  const hr = await getHrUser();
  if (!hr) {
    return NextResponse.json(
      { error: 'HR administrator access required.' },
      { status: 403 },
    );
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Malformed request.' }, { status: 400 });
  }

  const email = typeof body.email === 'string' ? body.email.trim() : '';
  const fullName = typeof body.fullName === 'string' ? body.fullName.trim() : '';

  if (!email || !email.includes('@')) {
    return NextResponse.json(
      { error: 'A valid email address is required.' },
      { status: 400 },
    );
  }
  if (!fullName) {
    return NextResponse.json({ error: 'Full name is required.' }, { status: 400 });
  }

  const admin = createAdminClient();

  if (!(await checkRateLimit(admin, RATE_LIMITS.invite, hr.id))) {
    return tooManyRequests(RATE_LIMITS.invite);
  }

  // Supabase emails an invite; the `on_auth_user_created` trigger creates the
  // matching employees row with the default 'employee' role.
  const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
    data: { full_name: fullName },
  });

  if (error) {
    return NextResponse.json(
      { error: error.message || 'Could not send the invite.' },
      { status: 400 },
    );
  }

  await recordAudit(admin, hr, {
    action: 'employee.invite',
    entityType: 'employee',
    entityId: data.user?.id ?? null,
    subjectId: data.user?.id ?? null,
    detail: { email, full_name: fullName },
  });

  return NextResponse.json({ id: data.user?.id, email });
}

export async function PATCH(request: Request) {
  const hr = await getHrUser();
  if (!hr) {
    return NextResponse.json(
      { error: 'HR administrator access required.' },
      { status: 403 },
    );
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Malformed request.' }, { status: 400 });
  }

  const id = typeof body.id === 'string' ? body.id : '';
  if (!id) {
    return NextResponse.json({ error: 'Missing employee id.' }, { status: 400 });
  }

  const admin = createAdminClient();

  const { data: target } = await admin
    .from('employees')
    .select('*')
    .eq('id', id)
    .single<Employee>();

  if (!target) {
    return NextResponse.json({ error: 'Employee not found.' }, { status: 404 });
  }

  // One HR administrator may not strip another's access.
  //
  // Self-demotion was already blocked, which stops you locking yourself out —
  // but not the more likely version: you promote a colleague, and they demote
  // or deactivate YOU. A flat admin tier where everyone can remove everyone
  // else has no safe resting state, and the system has no owner concept to
  // appeal to.
  //
  // So removing an administrator is deliberately an out-of-band act, run by
  // whoever holds the service-role key:
  //     npm run db:set-role -- <email> employee
  const removingAnAdmin =
    target.role === 'hr_admin' &&
    id !== hr.id &&
    ((body.role !== undefined && body.role !== 'hr_admin') || body.active === false);

  if (removingAnAdmin) {
    return NextResponse.json(
      {
        error:
          `${target.full_name} is an HR administrator. Administrators cannot be ` +
          'demoted or deactivated from here — ask whoever administers the ' +
          'database to run the set-role script.',
      },
      { status: 403 },
    );
  }

  const update: Record<string, unknown> = {};

  if (body.role !== undefined) {
    if (body.role !== 'employee' && body.role !== 'hr_admin') {
      return NextResponse.json({ error: 'Invalid role.' }, { status: 400 });
    }
    // Guard against an HR admin removing their own last privileges and
    // locking the whole company out of the review dashboard.
    if (id === hr.id && body.role !== 'hr_admin') {
      return NextResponse.json(
        { error: 'You cannot remove your own HR administrator role.' },
        { status: 400 },
      );
    }
    update.role = body.role;
  }

  if (body.active !== undefined) {
    if (typeof body.active !== 'boolean') {
      return NextResponse.json({ error: 'Invalid active flag.' }, { status: 400 });
    }
    if (id === hr.id && body.active === false) {
      return NextResponse.json(
        { error: 'You cannot deactivate your own account.' },
        { status: 400 },
      );
    }
    update.active = body.active;
  }

  if (body.defaultBranchId !== undefined) {
    update.default_branch_id =
      typeof body.defaultBranchId === 'string' && body.defaultBranchId
        ? body.defaultBranchId
        : null;
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: 'Nothing to update.' }, { status: 400 });
  }

  const { error } = await admin.from('employees').update(update).eq('id', id);

  if (error) {
    return NextResponse.json(
      { error: 'Could not update the employee.' },
      { status: 500 },
    );
  }

  // One PATCH can carry several changes; each is its own audit line and its own
  // notification, because "your role changed" and "your account was disabled"
  // are not the same news.
  if (update.role !== undefined && update.role !== target.role) {
    await recordAudit(admin, hr, {
      action: 'employee.role_change',
      entityType: 'employee',
      entityId: id,
      subjectId: id,
      detail: { from: target.role, to: update.role },
    });
    await notify(admin, [
      {
        recipientId: id,
        kind: 'role_changed',
        title:
          update.role === 'hr_admin'
            ? 'You are now an HR administrator'
            : 'Your role changed to employee',
        body: `Changed by ${hr.employee.full_name}.`,
        entityType: 'employee',
        entityId: id,
      },
    ]);
  }

  if (update.active !== undefined && update.active !== target.active) {
    const deactivated = update.active === false;
    await recordAudit(admin, hr, {
      action: deactivated ? 'employee.deactivate' : 'employee.activate',
      entityType: 'employee',
      entityId: id,
      subjectId: id,
      detail: { from: target.active, to: update.active },
    });
    // A deactivated employee cannot sign in to read this, but it is still
    // recorded — it is waiting if they are ever reactivated, and the audit log
    // is the copy that matters.
    await notify(admin, [
      {
        recipientId: id,
        kind: deactivated ? 'account_deactivated' : 'role_changed',
        title: deactivated
          ? 'Your account has been deactivated'
          : 'Your account has been reactivated',
        body: `Changed by ${hr.employee.full_name}.`,
        entityType: 'employee',
        entityId: id,
      },
    ]);
  }

  if (
    update.default_branch_id !== undefined &&
    update.default_branch_id !== target.default_branch_id
  ) {
    await recordAudit(admin, hr, {
      action: 'employee.branch_change',
      entityType: 'employee',
      entityId: id,
      subjectId: id,
      detail: { from: target.default_branch_id, to: update.default_branch_id },
    });
  }

  return NextResponse.json({ id, ...update });
}
