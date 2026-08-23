import { NextResponse } from 'next/server';
import { detectSpoofing } from '@/lib/attendance/detect';
import { isValidCoords } from '@/lib/geo';
import { hrAdminIds, notify } from '@/lib/notify';
import { peekBranchId, verifyBranchToken } from '@/lib/qr-token';
import { RATE_LIMITS, checkRateLimit, tooManyRequests } from '@/lib/rate-limit';
import { createAdminClient, getSessionUser } from '@/lib/supabase/server';
import { FLAG_REASON_LABELS, type BranchWithSecret } from '@/lib/types';

/**
 * POST /api/attendance/check-out — spec §7.2
 *
 * Updates the employee's open shift rather than creating a row. The same QR +
 * GPS verification and the same spoofing checks apply as on the way in.
 *
 * A shift that was already flagged on check-in stays flagged: closing it must
 * never quietly launder it into `approved`.
 */
export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });
  }

  let body: {
    token?: unknown;
    lat?: unknown;
    lng?: unknown;
    accuracy?: unknown;
    mockLocation?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Malformed request.' }, { status: 400 });
  }

  const token = typeof body.token === 'string' ? body.token : '';
  const coords = { lat: Number(body.lat), lng: Number(body.lng) };
  const accuracy =
    body.accuracy == null || Number.isNaN(Number(body.accuracy))
      ? null
      : Number(body.accuracy);
  const mockLocation = body.mockLocation === true;

  if (!token) {
    return NextResponse.json(
      { error: 'No QR code was scanned.' },
      { status: 400 },
    );
  }
  if (!isValidCoords(coords)) {
    return NextResponse.json(
      { error: 'Location unavailable. Enable location access and try again.' },
      { status: 400 },
    );
  }

  const admin = createAdminClient();

  if (!(await checkRateLimit(admin, RATE_LIMITS.checkOut, user.id))) {
    return tooManyRequests(RATE_LIMITS.checkOut);
  }

  const branchId = peekBranchId(token);
  if (!branchId) {
    return NextResponse.json(
      { error: 'That QR code is not a valid branch code.' },
      { status: 400 },
    );
  }

  const { data: branch } = await admin
    .from('branches')
    .select('*')
    .eq('id', branchId)
    .single<BranchWithSecret>();

  if (!branch) {
    return NextResponse.json(
      { error: 'That QR code refers to a branch that no longer exists.' },
      { status: 400 },
    );
  }

  const verified = verifyBranchToken(token, branch);
  if (!verified.ok) {
    return NextResponse.json(
      {
        error:
          verified.reason === 'stale_version'
            ? 'This QR code has been replaced. Please scan the current code at the entrance.'
            : 'That QR code could not be verified.',
      },
      { status: 400 },
    );
  }

  const { data: openRows } = await admin
    .from('attendance')
    .select('id, status, flag_reason, check_in_time, branch_id')
    .eq('employee_id', user.id)
    .eq('method', 'qr_gps')
    .in('status', ['approved', 'flagged'])
    .is('check_out_time', null)
    .order('check_in_time', { ascending: false, nullsFirst: false })
    .limit(1);

  const open = openRows?.[0];
  if (!open) {
    return NextResponse.json(
      { error: 'You have no open shift to check out of.' },
      { status: 409 },
    );
  }

  const detection = await detectSpoofing(admin, {
    employeeId: user.id,
    coords,
    branch,
    accuracyMeters: accuracy,
    mockLocationReported: mockLocation,
    excludeAttendanceId: open.id,
  });

  const now = new Date().toISOString();

  // Closing a shift at a branch other than the one it was opened at. Both
  // scans can be perfectly legitimate on their own — each inside its own
  // geofence — so nothing in detectSpoofing can see this: it only knows about
  // the branch in front of it, not the one this shift started at. Neither does
  // impossible-travel, which needs >250 km/h to trip and these branches are a
  // few km apart across a shift lasting hours.
  //
  // Flagged rather than refused, on the same principle as the rest of the
  // system: the person did work, and a human decides what it was worth.
  const branchMismatch = Boolean(open.branch_id) && branch.id !== open.branch_id;

  // A location flag from detectSpoofing outranks this one — a fake or
  // out-of-range fix is a stronger signal than working across two sites — but
  // a mismatch still beats no flag at all.
  const newFlagReason = detection.flagReason ?? (branchMismatch ? 'branch_mismatch' : null);

  // Flags only ever accumulate. An already-flagged shift keeps its original
  // reason so HR still sees why it was first raised.
  const status = newFlagReason || open.status === 'flagged' ? 'flagged' : 'approved';
  const flagReason = open.flag_reason ?? newFlagReason;

  const { error } = await admin
    .from('attendance')
    .update({
      check_out_time: now,
      check_out_lat: coords.lat,
      check_out_lng: coords.lng,
      check_out_branch_id: branch.id,
      status,
      flag_reason: flagReason,
    })
    .eq('id', open.id);

  if (error) {
    return NextResponse.json(
      { error: 'Could not record the check-out. Please try again.' },
      { status: 500 },
    );
  }

  // Name the branch the shift was opened at, so the response can say what
  // actually happened instead of "flagged" with no explanation.
  let openedAtName: string | null = null;
  if (branchMismatch) {
    const { data: openedAt } = await admin
      .from('branches')
      .select('name')
      .eq('id', open.branch_id)
      .single<{ name: string }>();
    openedAtName = openedAt?.name ?? null;
  }

  // Only announce a flag this check-out actually raised. A shift that arrived
  // already flagged was announced at check-in; saying it again would train
  // people to ignore the bell.
  if (newFlagReason) {
    const label = FLAG_REASON_LABELS[newFlagReason];
    const detail =
      detection.detail ??
      (branchMismatch
        ? `Opened at ${openedAtName ?? 'another branch'}, closed at ${branch.name}.`
        : '');

    await notify(admin, [
      {
        recipientId: user.id,
        kind: 'attendance_flagged',
        title: `Your check-out at ${branch.name} was flagged`,
        body: `${label}. ${detail}`.trim(),
        entityType: 'attendance',
        entityId: open.id,
      },
      ...(await hrAdminIds(admin, user.id)).map((hrId) => ({
        recipientId: hrId,
        kind: 'review_needed' as const,
        title: `Flagged check-out from ${user.employee.full_name}`,
        body: `${label}. ${detail}`.trim(),
        entityType: 'attendance' as const,
        entityId: open.id,
      })),
    ]);
  }

  return NextResponse.json({
    id: open.id,
    status,
    branchName: branch.name,
    checkInTime: open.check_in_time,
    checkOutTime: now,
    distanceMeters: Math.round(detection.distanceMeters),
    flagReason: newFlagReason,
    flagDetail:
      detection.detail ??
      (branchMismatch
        ? `Shift opened at ${openedAtName ?? 'another branch'} and closed at ${branch.name}.`
        : null),
    openedAtBranchName: openedAtName,
  });
}
