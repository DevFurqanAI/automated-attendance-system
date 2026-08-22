import { NextResponse } from 'next/server';
import { createAdminClient, getHrUser } from '@/lib/supabase/server';
import type { Attendance } from '@/lib/types';

/**
 * POST /api/hr/review — spec §7.4.7 and §7.5
 *
 * Approves or declines one record. Handles both queues:
 *  - `pending` remote requests: on approval the CLAIMED times are promoted into
 *    the verified columns (optionally corrected by HR first). This promotion is
 *    the only path by which a remote request ever counts toward a report.
 *  - `flagged` QR check-ins: approval reclassifies the row; its times were
 *    already system-verified, so they are left alone.
 */
export async function POST(request: Request) {
  const hr = await getHrUser();
  if (!hr) {
    return NextResponse.json(
      { error: 'HR administrator access required.' },
      { status: 403 },
    );
  }

  let body: {
    id?: unknown;
    action?: unknown;
    checkInTime?: unknown;
    checkOutTime?: unknown;
    branchId?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Malformed request.' }, { status: 400 });
  }

  const id = typeof body.id === 'string' ? body.id : '';
  const action = body.action;

  if (!id) {
    return NextResponse.json({ error: 'Missing record id.' }, { status: 400 });
  }
  if (action !== 'approve' && action !== 'decline') {
    return NextResponse.json(
      { error: 'Action must be "approve" or "decline".' },
      { status: 400 },
    );
  }

  const admin = createAdminClient();

  const { data: record } = await admin
    .from('attendance')
    .select('*')
    .eq('id', id)
    .single<Attendance>();

  if (!record) {
    return NextResponse.json({ error: 'Record not found.' }, { status: 404 });
  }

  // Only the two review queues are actionable. Re-reviewing a settled record
  // would silently rewrite history.
  if (record.status !== 'pending' && record.status !== 'flagged') {
    return NextResponse.json(
      { error: `This record has already been ${record.status}.` },
      { status: 409 },
    );
  }

  const reviewedAt = new Date().toISOString();

  if (action === 'decline') {
    const { error } = await admin
      .from('attendance')
      .update({
        status: 'declined',
        reviewed_by: hr.id,
        reviewed_at: reviewedAt,
      })
      .eq('id', id);

    if (error) {
      return NextResponse.json(
        { error: 'Could not decline the record.' },
        { status: 500 },
      );
    }
    return NextResponse.json({ id, status: 'declined' });
  }

  // ---- Approve -------------------------------------------------------------
  const update: Record<string, unknown> = {
    status: 'approved',
    reviewed_by: hr.id,
    reviewed_at: reviewedAt,
  };

  if (record.method === 'remote_request') {
    // HR may correct the claim before approving; fall back to the raw claim.
    const checkIn = parseDate(body.checkInTime) ?? toDate(record.claimed_check_in_time);
    const checkOut =
      body.checkOutTime === null || body.checkOutTime === ''
        ? null
        : (parseDate(body.checkOutTime) ?? toDate(record.claimed_check_out_time));

    if (!checkIn) {
      return NextResponse.json(
        { error: 'A verified check-in time is required to approve.' },
        { status: 400 },
      );
    }
    if (checkOut && checkOut < checkIn) {
      return NextResponse.json(
        { error: 'Check-out cannot be before check-in.' },
        { status: 400 },
      );
    }

    update.check_in_time = checkIn.toISOString();
    update.check_out_time = checkOut?.toISOString() ?? null;

    if (typeof body.branchId === 'string' && body.branchId) {
      update.branch_id = body.branchId;
    } else if (body.branchId === null) {
      update.branch_id = null;
    }
  }

  const { error } = await admin.from('attendance').update(update).eq('id', id);

  if (error) {
    return NextResponse.json(
      { error: 'Could not approve the record.' },
      { status: 500 },
    );
  }

  return NextResponse.json({ id, status: 'approved' });
}

function parseDate(value: unknown): Date | null {
  if (typeof value !== 'string' || !value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function toDate(value: string | null): Date | null {
  return value ? new Date(value) : null;
}
