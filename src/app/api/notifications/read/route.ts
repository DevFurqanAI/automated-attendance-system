import { NextResponse } from 'next/server';
import { createAdminClient, getSessionUser } from '@/lib/supabase/server';

/**
 * POST /api/notifications/read — mark the caller's notifications as read.
 *
 * Body: `{ ids: string[] }` for specific ones, or `{}` for everything unread.
 *
 * Goes through the service role because `authenticated` holds no write grant
 * on the table (see 20260824090000_harden_grants.sql). The `eq('recipient_id')`
 * below is therefore doing real work — it is the only thing scoping this to the
 * caller, so it must never be dropped.
 */
export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });
  }

  let ids: string[] | null = null;
  try {
    const body = await request.json();
    if (Array.isArray(body?.ids)) {
      ids = body.ids.filter((v: unknown): v is string => typeof v === 'string');
    }
  } catch {
    // An empty or malformed body means "all of them", which is the common case.
  }

  const admin = createAdminClient();

  let query = admin
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('recipient_id', user.id)
    .is('read_at', null);

  if (ids && ids.length > 0) query = query.in('id', ids);

  const { error } = await query;

  if (error) {
    return NextResponse.json(
      { error: 'Could not update notifications.' },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true });
}
