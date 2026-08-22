import { NextResponse } from 'next/server';
import { validateRemoteClaim } from '@/lib/attendance/remote-claim';
import { isValidCoords } from '@/lib/geo';
import { createAdminClient, getSessionUser } from '@/lib/supabase/server';

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

  return NextResponse.json({
    id: inserted.id,
    status: 'pending',
    submittedAt: inserted.submitted_at,
  });
}

function parseDate(value: unknown): Date | null {
  if (typeof value !== 'string' || !value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}
