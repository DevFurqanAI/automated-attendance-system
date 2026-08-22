import { NextResponse } from 'next/server';
import { createAdminClient, getHrUser } from '@/lib/supabase/server';

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

  const admin = createAdminClient();
  const { error } = await admin.from('employees').update(update).eq('id', id);

  if (error) {
    return NextResponse.json(
      { error: 'Could not update the employee.' },
      { status: 500 },
    );
  }

  return NextResponse.json({ id, ...update });
}
