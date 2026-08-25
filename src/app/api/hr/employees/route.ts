import { NextResponse } from 'next/server';
import { recordAudit } from '@/lib/audit';
import { isEmployeeVisibleTo } from '@/lib/hr-scope';
import { notify } from '@/lib/notify';
import { RATE_LIMITS, checkRateLimit, tooManyRequests } from '@/lib/rate-limit';
import { createAdminClient, getHrUser, getSuperAdminUser } from '@/lib/supabase/server';
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

  // Role changes and branch reassignment are super_admin-only — see
  // docs/superpowers/specs/2026-08-24-absence-leave-hr-scoping-design.md
  // "HR branch scoping". A scoped hr_admin keeps day-to-day management
  // (activate/deactivate) for employees in their branches, checked below.
  if (body.role !== undefined || body.defaultBranchId !== undefined) {
    if (hr.employee.role !== 'super_admin') {
      return NextResponse.json(
        {
          error:
            "Only a super administrator can change an employee's role or " +
            'default branch.',
        },
        { status: 403 },
      );
    }
  }

  // Deactivating or reactivating an hr_admin/super_admin is always
  // super_admin-only — the same "no admin can strip another's access"
  // reasoning as before, now framed around the tier rather than a flat
  // hr_admin/hr_admin check.
  if (body.active !== undefined && target.role !== 'employee' && hr.employee.role !== 'super_admin') {
    return NextResponse.json(
      {
        error:
          `${target.full_name} is an HR administrator. Only a super ` +
          'administrator can activate or deactivate another administrator.',
      },
      { status: 403 },
    );
  }

  // Changing an admin's sign-in email is access-affecting the same way
  // deactivating one is — the same "no admin can strip another's access"
  // reasoning as the active-flag guard above.
  if (body.email !== undefined && target.role !== 'employee' && hr.employee.role !== 'super_admin') {
    return NextResponse.json(
      {
        error:
          `${target.full_name} is an HR administrator. Only a super ` +
          'administrator can change another administrator’s email.',
      },
      { status: 403 },
    );
  }

  // A scoped hr_admin may only touch employees within their assigned
  // branches (or branch-less employees).
  if (hr.employee.role !== 'super_admin' && !(await isEmployeeVisibleTo(admin, hr, target))) {
    return NextResponse.json(
      { error: 'This employee is not in one of your assigned branches.' },
      { status: 403 },
    );
  }

  // Work email correction — a typo'd invite, or an employee's address
  // changing. Updates the Supabase Auth identity first (the thing that
  // actually gates sign-in); `employees.email` is kept in sync below.
  // `email_confirm: true` skips a confirmation email — HR making this change
  // is already the verification, the same trust level as inviteUserByEmail.
  let newEmail: string | null = null;
  if (body.email !== undefined) {
    newEmail = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    if (!newEmail || !newEmail.includes('@')) {
      return NextResponse.json(
        { error: 'A valid email address is required.' },
        { status: 400 },
      );
    }
    if (newEmail !== target.email) {
      const { error: authError } = await admin.auth.admin.updateUserById(id, {
        email: newEmail,
        email_confirm: true,
      });
      if (authError) {
        return NextResponse.json(
          { error: authError.message || 'Could not change the email address.' },
          { status: 400 },
        );
      }
    }
  }

  const update: Record<string, unknown> = {};

  if (newEmail !== null) {
    update.email = newEmail;
  }

  if (body.role !== undefined) {
    if (body.role !== 'employee' && body.role !== 'hr_admin' && body.role !== 'super_admin') {
      return NextResponse.json({ error: 'Invalid role.' }, { status: 400 });
    }
    if (id === hr.id && body.role !== 'super_admin') {
      return NextResponse.json(
        { error: 'You cannot remove your own super administrator role.' },
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

  // Personal weekly-off override — see private.is_working_day() in
  // 20260824101000_schedule_holidays.sql. `null` clears the override, falling
  // back to the employee's branch (or Sunday, if they have none — see
  // 20260825092000_is_working_day_branchless_default.sql).
  if (body.weeklyOffDays !== undefined) {
    if (
      body.weeklyOffDays !== null &&
      (!Array.isArray(body.weeklyOffDays) ||
        !body.weeklyOffDays.every((d) => Number.isInteger(d) && d >= 0 && d <= 6))
    ) {
      return NextResponse.json(
        { error: 'weeklyOffDays must be an array of integers between 0 and 6, or null.' },
        { status: 400 },
      );
    }
    update.weekly_off_days = body.weeklyOffDays;
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

  if (
    update.weekly_off_days !== undefined &&
    JSON.stringify(update.weekly_off_days) !== JSON.stringify(target.weekly_off_days)
  ) {
    await recordAudit(admin, hr, {
      action: 'employee.weekly_off_days_change',
      entityType: 'employee',
      entityId: id,
      subjectId: id,
      detail: { from: target.weekly_off_days, to: update.weekly_off_days },
    });
  }

  if (update.email !== undefined && update.email !== target.email) {
    await recordAudit(admin, hr, {
      action: 'employee.email_change',
      entityType: 'employee',
      entityId: id,
      subjectId: id,
      detail: { from: target.email, to: update.email },
    });
    // Sent to the NEW address — the whole point of the change is that the
    // old one is no longer how this person is reached.
    await notify(admin, [
      {
        recipientId: id,
        kind: 'email_changed',
        title: 'Your work email was changed',
        body: `Changed by ${hr.employee.full_name}. New sign-in address: ${update.email}.`,
        entityType: 'employee',
        entityId: id,
      },
    ]);
  }

  return NextResponse.json({ id, ...update });
}

/**
 * DELETE /api/hr/employees?id=…&confirmEmail=… — permanently delete an
 * employee.
 *
 * super_admin-only, and stricter than every other admin-protection guard in
 * this file: those stop one admin from stripping another's *access*; this
 * stops data destruction, so it applies regardless of the target's role.
 *
 * IRREVERSIBLE. `employees.id references auth.users(id) on delete cascade`,
 * and attendance/leave_requests/absences/notifications/hr_branch_assignments
 * all cascade from employees — deleting the auth user wipes every record tied
 * to this person. Only audit_log survives: actor_id/subject_id are `on
 * delete set null`, kept readable by the actor_name/actor_email columns
 * denormalized for exactly this case (see 20260824092000_audit_log.sql).
 *
 * `confirmEmail` must match the target's current email exactly — the
 * client-side guard against "meant to click Deactivate."
 */
export async function DELETE(request: Request) {
  const superAdmin = await getSuperAdminUser();
  if (!superAdmin) {
    return NextResponse.json(
      { error: 'Super administrator access required.' },
      { status: 403 },
    );
  }

  const params = new URL(request.url).searchParams;
  const id = params.get('id');
  const confirmEmail = params.get('confirmEmail')?.trim().toLowerCase() ?? '';

  if (!id) {
    return NextResponse.json({ error: 'Missing employee id.' }, { status: 400 });
  }
  if (id === superAdmin.id) {
    return NextResponse.json(
      { error: 'You cannot delete your own account.' },
      { status: 400 },
    );
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
  if (!confirmEmail || confirmEmail !== target.email.toLowerCase()) {
    return NextResponse.json(
      { error: 'Confirmation email does not match.' },
      { status: 400 },
    );
  }

  // Snapshot before the row stops existing — nothing to denormalize from
  // afterward.
  const snapshot = {
    full_name: target.full_name,
    email: target.email,
    role: target.role,
    default_branch_id: target.default_branch_id,
  };

  const { error: deleteError } = await admin.auth.admin.deleteUser(id);
  if (deleteError) {
    return NextResponse.json(
      { error: deleteError.message || 'Could not delete the employee.' },
      { status: 500 },
    );
  }

  // subjectId is deliberately omitted: the FK it would reference no longer
  // exists (an INSERT can't set-null what it's inserting, only a later
  // DELETE can) — the snapshot in `detail` is the record from here on.
  await recordAudit(admin, superAdmin, {
    action: 'employee.delete',
    entityType: 'employee',
    entityId: id,
    detail: snapshot,
  });

  return NextResponse.json({ id, deleted: true });
}
