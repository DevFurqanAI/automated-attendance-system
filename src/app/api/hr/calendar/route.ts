import { NextResponse } from 'next/server';
import { recordAudit } from '@/lib/audit';
import { createAdminClient, getSuperAdminUser } from '@/lib/supabase/server';

/**
 * POST /api/hr/calendar — declare a company-wide holiday or mandatory
 * workday (branch_id null — every branch, and every branch-less employee).
 * DELETE /api/hr/calendar?calendarId=... — remove one.
 *
 * Super-admin only: this affects every branch, not just what a scoped
 * hr_admin manages — see 20260825103000_company_wide_calendar.sql for the
 * precedence (a branch-specific entry for the same date still wins).
 */
export async function POST(request: Request) {
  const hr = await getSuperAdminUser();
  if (!hr) {
    return NextResponse.json(
      { error: 'Super administrator access required.' },
      { status: 403 },
    );
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

  const admin = createAdminClient();

  // Not a plain .upsert(): the uniqueness that matters here is the partial
  // index "one company-wide entry per date" (branch_id is null), and
  // PostgREST's onConflict can't target a partial index's WHERE predicate —
  // it would emit `ON CONFLICT (date)` with no predicate, which doesn't
  // match and errors. Check-then-write instead.
  const { data: existing } = await admin
    .from('branch_calendar_days')
    .select('id')
    .is('branch_id', null)
    .eq('date', date)
    .maybeSingle();

  const { data, error } = existing
    ? await admin
        .from('branch_calendar_days')
        .update({ kind, label })
        .eq('id', existing.id)
        .select('id, date, kind, label')
        .single()
    : await admin
        .from('branch_calendar_days')
        .insert({ branch_id: null, date, kind, label })
        .select('id, date, kind, label')
        .single();

  if (error) {
    return NextResponse.json({ error: 'Could not save the calendar day.' }, { status: 500 });
  }

  await recordAudit(admin, hr, {
    action: 'branch.update',
    entityType: 'branch',
    entityId: null,
    detail: { calendar_day: data, company_wide: true },
  });

  return NextResponse.json(data);
}

export async function DELETE(request: Request) {
  const hr = await getSuperAdminUser();
  if (!hr) {
    return NextResponse.json(
      { error: 'Super administrator access required.' },
      { status: 403 },
    );
  }

  const calendarId = new URL(request.url).searchParams.get('calendarId');
  if (!calendarId) {
    return NextResponse.json({ error: 'Missing calendarId.' }, { status: 400 });
  }

  const admin = createAdminClient();

  const { error } = await admin
    .from('branch_calendar_days')
    .delete()
    .eq('id', calendarId)
    .is('branch_id', null);

  if (error) {
    return NextResponse.json({ error: 'Could not remove the calendar day.' }, { status: 500 });
  }

  await recordAudit(admin, hr, {
    action: 'branch.update',
    entityType: 'branch',
    entityId: null,
    detail: { calendar_day_removed: calendarId, company_wide: true },
  });

  return NextResponse.json({ ok: true });
}
