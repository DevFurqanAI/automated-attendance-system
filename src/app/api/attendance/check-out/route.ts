import { NextResponse } from 'next/server';
import { detectSpoofing } from '@/lib/attendance/detect';
import { isValidCoords } from '@/lib/geo';
import { peekBranchId, verifyBranchToken } from '@/lib/qr-token';
import { createAdminClient, getSessionUser } from '@/lib/supabase/server';
import type { BranchWithSecret } from '@/lib/types';

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

  // Flags only ever accumulate. An already-flagged shift keeps its original
  // reason so HR still sees why it was first raised.
  const status = detection.flagReason || open.status === 'flagged' ? 'flagged' : 'approved';
  const flagReason = open.flag_reason ?? detection.flagReason;

  const { error } = await admin
    .from('attendance')
    .update({
      check_out_time: now,
      check_out_lat: coords.lat,
      check_out_lng: coords.lng,
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

  return NextResponse.json({
    id: open.id,
    status,
    branchName: branch.name,
    checkInTime: open.check_in_time,
    checkOutTime: now,
    distanceMeters: Math.round(detection.distanceMeters),
    flagReason: detection.flagReason,
    flagDetail: detection.detail,
  });
}
