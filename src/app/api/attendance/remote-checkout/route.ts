import { NextResponse } from 'next/server';
import { validateRemoteCheckoutClaim } from '@/lib/attendance/remote-claim';
import { notify, scopedHrRecipientIds } from '@/lib/notify';
import { RATE_LIMITS, checkRateLimit, tooManyRequests } from '@/lib/rate-limit';
import { createAdminClient, getSessionUser } from '@/lib/supabase/server';
import type { Attendance } from '@/lib/types';

/**
 * POST /api/attendance/remote-checkout
 *
 * For an employee who checked in via QR+GPS, then left for a meeting or an
 * errand and never made it back to scan out — there is otherwise no way to
 * close that shift: check-out requires a branch's QR code, and the employee
 * cannot check in anywhere else until it is closed (the partial unique index
 * in the init migration).
 *
 * Attaches a claimed check-out time and reason to the EXISTING open shift —
 * not a new row, unlike /api/attendance/remote, which is for an entire day
 * worked remotely — and flags it for HR review. HR's 'force_checkout' action
 * (src/app/api/hr/review/route.ts) closes it, pre-filled from this claim; the
 * shift then goes through the normal approve/decline review like any other
 * flagged record.
 */
export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });
  }

  let body: { reason?: unknown; claimedCheckOutTime?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Malformed request.' }, { status: 400 });
  }

  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
  if (!reason) {
    return NextResponse.json(
      { error: 'A reason is required to request a remote checkout.' },
      { status: 400 },
    );
  }
  if (reason.length > 500) {
    return NextResponse.json(
      { error: 'Reason must be 500 characters or fewer.' },
      { status: 400 },
    );
  }

  const admin = createAdminClient();

  if (!(await checkRateLimit(admin, RATE_LIMITS.remoteCheckout, user.id))) {
    return tooManyRequests(RATE_LIMITS.remoteCheckout);
  }

  const { data: openRows } = await admin
    .from('attendance')
    .select('*')
    .eq('employee_id', user.id)
    .eq('method', 'qr_gps')
    .in('status', ['approved', 'flagged'])
    .is('check_out_time', null)
    .order('check_in_time', { ascending: false, nullsFirst: false })
    .limit(1)
    .returns<Attendance[]>();

  const open = openRows?.[0];
  if (!open || !open.check_in_time) {
    return NextResponse.json(
      { error: 'You have no open shift to close.' },
      { status: 409 },
    );
  }

  const claimed =
    typeof body.claimedCheckOutTime === 'string' && body.claimedCheckOutTime
      ? new Date(body.claimedCheckOutTime)
      : null;

  const validated = validateRemoteCheckoutClaim(new Date(open.check_in_time), claimed);
  if (!validated.ok) {
    return NextResponse.json({ error: validated.error }, { status: 400 });
  }

  // Flags only ever accumulate — an already-flagged shift keeps whatever
  // reason first raised it, same principle as check-out's own branch-mismatch
  // handling (src/app/api/attendance/check-out/route.ts).
  const flagReason = open.flag_reason ?? 'remote_checkout_requested';

  const { error } = await admin
    .from('attendance')
    .update({
      claimed_check_out_time: validated.checkOut.toISOString(),
      remote_reason: reason,
      status: 'flagged',
      flag_reason: flagReason,
    })
    .eq('id', open.id);

  if (error) {
    return NextResponse.json(
      { error: 'Could not submit the request. Please try again.' },
      { status: 500 },
    );
  }

  await notify(
    admin,
    (await scopedHrRecipientIds(admin, user.id, user.id)).map((hrId) => ({
      recipientId: hrId,
      kind: 'review_needed' as const,
      title: `Remote checkout requested by ${user.employee.full_name}`,
      body: `${reason}. Claimed checkout ${validated.checkOut.toISOString().slice(0, 16).replace('T', ' ')} UTC.`,
      entityType: 'attendance' as const,
      entityId: open.id,
    })),
  );

  return NextResponse.json({
    id: open.id,
    status: 'flagged',
    claimedCheckOutTime: validated.checkOut.toISOString(),
  });
}
