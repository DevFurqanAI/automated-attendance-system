import { NextResponse } from 'next/server';
import { validateRemoteClaim } from '@/lib/attendance/remote-claim';
import { TZ } from '@/lib/format';
import { isValidCoords } from '@/lib/geo';
import { hrAdminIds, notify } from '@/lib/notify';
import { RATE_LIMITS, checkRateLimit, tooManyRequests } from '@/lib/rate-limit';
import { createAdminClient, getSessionUser } from '@/lib/supabase/server';
import type { Attendance } from '@/lib/types';

const dayInTz = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(d);

/**
 * POST /api/attendance/remote — spec §7.4
 *
 * Creates a `pending` row carrying the staff member's *claimed* times. The
 * verified check_in_time / check_out_time stay NULL until HR approves, which is
 * what keeps an unapproved request out of every report.
 *
 * The 2-day claim window is re-validated here, independently of the form.
 * The client-side limit is a convenience; this is the enforcement.
 */

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });
  }

  let body: {
    reason?: unknown;
    claimedCheckIn?: unknown;
    claimedCheckOut?: unknown;
    lat?: unknown;
    lng?: unknown;
    accuracy?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Malformed request.' }, { status: 400 });
  }

  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
  if (!reason) {
    return NextResponse.json(
      { error: 'A reason is required for a remote check-in.' },
      { status: 400 },
    );
  }
  if (reason.length > 500) {
    return NextResponse.json(
      { error: 'Reason must be 500 characters or fewer.' },
      { status: 400 },
    );
  }

  if (body.claimedCheckOut && !parseDate(body.claimedCheckOut)) {
    return NextResponse.json(
      { error: 'The claimed check-out time is not a valid date.' },
      { status: 400 },
    );
  }

  const now = new Date();

  // ---- Server-side enforcement of the claim window (acceptance criterion) ---
  // Re-validated here regardless of what the form allowed.
  const claim = validateRemoteClaim(
    parseDate(body.claimedCheckIn),
    body.claimedCheckOut == null || body.claimedCheckOut === ''
      ? null
      : parseDate(body.claimedCheckOut),
    now,
  );

  if (!claim.ok) {
    return NextResponse.json({ error: claim.error }, { status: 400 });
  }

  const { checkIn: claimedCheckIn, checkOut: claimedCheckOut } = claim;

  // GPS is best-effort here: a genuinely remote worker may be nowhere near a
  // branch, so a missing fix is recorded as null rather than rejected.
  const coords = { lat: Number(body.lat), lng: Number(body.lng) };
  const hasCoords = isValidCoords(coords);
  const accuracy =
    body.accuracy == null || Number.isNaN(Number(body.accuracy))
      ? null
      : Number(body.accuracy);

  const admin = createAdminClient();

  if (!(await checkRateLimit(admin, RATE_LIMITS.remote, user.id))) {
    return tooManyRequests(RATE_LIMITS.remote);
  }

  // Guards against a double-tap on a slow connection creating two pending
  // requests for the same claimed day — not a hard business rule (withdrawing
  // the first one and resubmitting is always available), just a duplicate
  // catch. Scoped to 'pending': an already-reviewed request for the same day
  // is a real correction, not a double-submit.
  const { data: pending } = await admin
    .from('attendance')
    .select('id, claimed_check_in_time')
    .eq('employee_id', user.id)
    .eq('method', 'remote_request')
    .eq('status', 'pending')
    .returns<{ id: string; claimed_check_in_time: string | null }[]>();

  const claimedDay = dayInTz(claimedCheckIn);
  const duplicate = (pending ?? []).find(
    (r) => r.claimed_check_in_time && dayInTz(new Date(r.claimed_check_in_time)) === claimedDay,
  );
  if (duplicate) {
    return NextResponse.json(
      {
        error:
          'You already have a pending remote request for that day. Withdraw ' +
          'it first if you need to resubmit.',
      },
      { status: 409 },
    );
  }

  const { data: inserted, error } = await admin
    .from('attendance')
    .insert({
      employee_id: user.id,
      // Left null: a remote request is by definition not at a branch. HR can
      // attribute one at approval time if the work belongs to a branch.
      branch_id: null,
      check_in_time: null,
      check_out_time: null,
      submitted_at: now.toISOString(),
      claimed_check_in_time: claimedCheckIn.toISOString(),
      claimed_check_out_time: claimedCheckOut?.toISOString() ?? null,
      check_in_lat: hasCoords ? coords.lat : null,
      check_in_lng: hasCoords ? coords.lng : null,
      check_in_accuracy_meters: hasCoords ? accuracy : null,
      method: 'remote_request',
      status: 'pending',
      remote_reason: reason,
    })
    .select('id, submitted_at')
    .single();

  if (error) {
    return NextResponse.json(
      { error: 'Could not submit the request. Please try again.' },
      { status: 500 },
    );
  }

  // A pending request earns nothing until HR acts on it, so the only thing
  // standing between the employee and unpaid work is somebody noticing.
  await notify(
    admin,
    (await hrAdminIds(admin, user.id)).map((hrId) => ({
      recipientId: hrId,
      kind: 'remote_submitted' as const,
      title: `Remote check-in request from ${user.employee.full_name}`,
      body: `${reason}. Claimed ${claimedCheckIn.toISOString().slice(0, 16).replace('T', ' ')} UTC.`,
      entityType: 'attendance' as const,
      entityId: inserted.id,
    })),
  );

  return NextResponse.json({
    id: inserted.id,
    status: 'pending',
    submittedAt: inserted.submitted_at,
  });
}

/**
 * DELETE /api/attendance/remote?id=… — withdraw the caller's own pending
 * remote check-in request.
 *
 * Distinct from an HR decline for the same reason as the leave-request
 * counterpart (see DELETE /api/attendance/leave): the request never reached
 * review, so "withdrawn" is the honest status, not "declined". Scoped to
 * method='remote_request' — a claimed checkout on an already-open qr_gps
 * shift (POST /api/attendance/remote-checkout) is a different thing with its
 * own resolution path via HR's force-checkout.
 */
export async function DELETE(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });
  }

  const id = new URL(request.url).searchParams.get('id');
  if (!id) {
    return NextResponse.json({ error: 'Missing request id.' }, { status: 400 });
  }

  const admin = createAdminClient();

  const { data: record } = await admin
    .from('attendance')
    .select('*')
    .eq('id', id)
    .single<Attendance>();

  if (!record || record.employee_id !== user.id || record.method !== 'remote_request') {
    return NextResponse.json({ error: 'Request not found.' }, { status: 404 });
  }
  if (record.status !== 'pending') {
    return NextResponse.json(
      { error: `This request has already been ${record.status} and can no longer be withdrawn.` },
      { status: 409 },
    );
  }

  const { error } = await admin
    .from('attendance')
    .update({ status: 'withdrawn' })
    .eq('id', id);

  if (error) {
    return NextResponse.json(
      { error: 'Could not withdraw the request. Please try again.' },
      { status: 500 },
    );
  }

  return NextResponse.json({ id, status: 'withdrawn' });
}

function parseDate(value: unknown): Date | null {
  if (typeof value !== 'string' || !value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}
