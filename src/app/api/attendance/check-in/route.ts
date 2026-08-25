import { NextResponse } from 'next/server';
import { isWithinCheckinWindow } from '@/lib/attendance/checkin-window';
import { detectSpoofing } from '@/lib/attendance/detect';
import { isValidCoords } from '@/lib/geo';
import { hrAdminIds, notify } from '@/lib/notify';
import { peekBranchId, verifyBranchToken } from '@/lib/qr-token';
import { RATE_LIMITS, checkRateLimit, tooManyRequests } from '@/lib/rate-limit';
import { createAdminClient, getSessionUser } from '@/lib/supabase/server';
import { FLAG_REASON_LABELS, type BranchWithSecret } from '@/lib/types';

/**
 * POST /api/attendance/check-in  — spec §7.1
 *
 * Both factors are required: a QR token that verifies against the branch's own
 * secret, AND a GPS fix. A failure of the *location* factor is recorded as
 * `flagged` and queued for HR, never silently dropped (§7.1.8/9). A failure of
 * the *token* factor is rejected outright — an unverifiable token identifies no
 * branch, so there is nothing meaningful to record.
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
      {
        error:
          'Location unavailable. Enable location access and try again — ' +
          'check-in needs both the QR code and your GPS position.',
      },
      { status: 400 },
    );
  }

  // Service role: staff are not permitted to read qr_secret, and the status of
  // the row they are about to create is the server's decision alone.
  const admin = createAdminClient();

  if (!(await checkRateLimit(admin, RATE_LIMITS.checkIn, user.id))) {
    return tooManyRequests(RATE_LIMITS.checkIn);
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
            : 'That QR code could not be verified. Please scan the official branch code.',
      },
      { status: 400 },
    );
  }

  // Refuse a second check-in while a shift is still open — the partial unique
  // index enforces this too, but a clear message beats a constraint error.
  const { data: open } = await admin
    .from('attendance')
    .select('id, check_in_time, branch_id')
    .eq('employee_id', user.id)
    .eq('method', 'qr_gps')
    .in('status', ['approved', 'flagged'])
    .is('check_out_time', null)
    .limit(1);

  if (open?.length) {
    return NextResponse.json(
      {
        error:
          'You are already checked in. Check out before starting a new shift.',
        openAttendanceId: open[0].id,
      },
      { status: 409 },
    );
  }

  const detection = await detectSpoofing(admin, {
    employeeId: user.id,
    coords,
    branch,
    accuracyMeters: accuracy,
    mockLocationReported: mockLocation,
  });

  const now = new Date().toISOString();

  // A location/spoofing flag outranks the check-in window — a fake or
  // out-of-range fix is a stronger signal than arriving outside business
  // hours — but the window still beats no flag at all.
  const outsideWindow = !isWithinCheckinWindow(
    now,
    branch.checkin_window_start,
    branch.checkin_window_end,
  );
  const flagReason = detection.flagReason ?? (outsideWindow ? 'outside_checkin_window' : null);
  const status = flagReason ? 'flagged' : 'approved';

  const { data: inserted, error } = await admin
    .from('attendance')
    .insert({
      employee_id: user.id,
      branch_id: branch.id,
      check_in_time: now,
      submitted_at: now,
      check_in_lat: coords.lat,
      check_in_lng: coords.lng,
      check_in_accuracy_meters: accuracy,
      method: 'qr_gps',
      status,
      flag_reason: flagReason,
    })
    .select('id')
    .single();

  if (error) {
    return NextResponse.json(
      { error: 'Could not record the check-in. Please try again.' },
      { status: 500 },
    );
  }

  // A flag is the one outcome nobody would otherwise learn about in time: the
  // employee thinks they are checked in, and HR only finds out if the dashboard
  // happens to be open.
  if (status === 'flagged' && flagReason) {
    const label = FLAG_REASON_LABELS[flagReason];
    await notify(admin, [
      {
        recipientId: user.id,
        kind: 'attendance_flagged',
        title: `Your check-in at ${branch.name} was flagged`,
        body:
          `${label}. ${detection.detail ?? ''} `.trim() +
          ' It has been sent to HR for review and does not count until approved.',
        entityType: 'attendance',
        entityId: inserted.id,
      },
      ...(await hrAdminIds(admin, user.id)).map((hrId) => ({
        recipientId: hrId,
        kind: 'review_needed' as const,
        title: `Flagged check-in from ${user.employee.full_name}`,
        body: `${label} at ${branch.name}. ${detection.detail ?? ''}`.trim(),
        entityType: 'attendance' as const,
        entityId: inserted.id,
      })),
    ]);
  }

  return NextResponse.json({
    id: inserted.id,
    status,
    branchName: branch.name,
    checkInTime: now,
    distanceMeters: Math.round(detection.distanceMeters),
    flagReason,
    flagDetail: detection.detail,
  });
}
