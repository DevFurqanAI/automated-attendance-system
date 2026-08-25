import { NextResponse } from 'next/server';
import { createAdminClient, getSessionUser } from '@/lib/supabase/server';

/**
 * PATCH /api/notifications/preferences — self-service email opt-in/out.
 *
 * Body: `{ emailNotificationsEnabled: boolean }`. Own row only — there is no
 * employeeId; the caller can only ever change their own preference. Goes
 * through the service role because `authenticated` holds no UPDATE grant on
 * employees (see 20260824090000_harden_grants.sql); the `.eq('id', user.id)`
 * below is what scopes this to the caller, so it must never be dropped.
 */
export async function PATCH(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });
  }

  let body: { emailNotificationsEnabled?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Malformed request.' }, { status: 400 });
  }

  if (typeof body.emailNotificationsEnabled !== 'boolean') {
    return NextResponse.json(
      { error: 'emailNotificationsEnabled must be a boolean.' },
      { status: 400 },
    );
  }

  const admin = createAdminClient();

  const { error } = await admin
    .from('employees')
    .update({ email_notifications_enabled: body.emailNotificationsEnabled })
    .eq('id', user.id);

  if (error) {
    return NextResponse.json(
      { error: 'Could not update your preference.' },
      { status: 500 },
    );
  }

  return NextResponse.json({ emailNotificationsEnabled: body.emailNotificationsEnabled });
}
