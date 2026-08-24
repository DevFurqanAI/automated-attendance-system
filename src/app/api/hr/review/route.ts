import { NextResponse } from 'next/server';
import { recordAudit } from '@/lib/audit';
import { notify } from '@/lib/notify';
import { createAdminClient, getHrUser } from '@/lib/supabase/server';
import { FLAG_REASON_LABELS, type Attendance } from '@/lib/types';

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

  // A shift that has not been closed yet is not reviewable, because reviewing
  // it corrupts the record either way:
  //
  //  - Declining sets status='declined', which drops the row out of every
  //    "open shift" lookup (they all filter on approved/flagged, as does the
  //    partial unique index). The employee can then never check out — they get
  //    "You have no open shift" — the row is stranded with a null
  //    check_out_time, and they can silently start a second shift.
  //  - Approving is undone moments later: if the check-out trips a flag, the
  //    row flips back to 'flagged' while keeping this review's reviewed_by and
  //    reviewed_at, so it re-enters the queue looking already-handled.
  //
  // Remote requests are exempt: they have no live shift to close.
  if (record.method === 'qr_gps' && !record.check_out_time) {
    return NextResponse.json(
      {
        error:
          'This shift is still open. It can be reviewed once the employee has ' +
          'checked out.',
      },
      { status: 409 },
    );
  }

  // Reviewing your own attendance is allowed — with one HR administrator there
  // is often nobody else — but it is never invisible. It is stamped here, shown
  // in the queue, and written to the audit log.
  const selfReview = record.employee_id === hr.id;

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

    await recordAudit(admin, hr, {
      action: 'attendance.decline',
      entityType: 'attendance',
      entityId: id,
      subjectId: record.employee_id,
      detail: {
        method: record.method,
        previous_status: record.status,
        flag_reason: record.flag_reason,
      },
    });

    await notify(admin, [
      {
        recipientId: record.employee_id,
        kind: 'attendance_declined',
        title: describe(record) + ' was declined',
        body: reviewerLine(hr.employee.full_name, selfReview),
        entityType: 'attendance',
        entityId: id,
      },
    ]);

    return NextResponse.json({ id, status: 'declined', selfReview });
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

  await recordAudit(admin, hr, {
    action: 'attendance.approve',
    entityType: 'attendance',
    entityId: id,
    subjectId: record.employee_id,
    detail: {
      method: record.method,
      previous_status: record.status,
      flag_reason: record.flag_reason,
      // Only meaningful for remote requests, where HR may correct the claim.
      check_in_time: update.check_in_time ?? record.check_in_time,
      check_out_time: update.check_out_time ?? record.check_out_time,
    },
  });

  // A late-approved remote request can retroactively cover a date the
  // nightly job already marked absent (see "Late reversal" in the design
  // doc) — only relevant for remote requests, which carry a claimed date
  // separate from submission time.
  if (record.method === 'remote_request' && update.check_in_time) {
    const coveredDate = new Date(update.check_in_time as string)
      .toLocaleDateString('en-CA', { timeZone: 'Asia/Karachi' });

    const { data: reversed } = await admin
      .from('absences')
      .delete()
      .eq('employee_id', record.employee_id)
      .eq('date', coveredDate)
      .select('date');

    if (reversed && reversed.length > 0) {
      await recordAudit(admin, hr, {
        action: 'absence.reversed',
        entityType: 'attendance',
        entityId: id,
        subjectId: record.employee_id,
        detail: { dates: reversed.map((r) => r.date) },
      });
    }
  }

  await notify(admin, [
    {
      recipientId: record.employee_id,
      kind: 'attendance_approved',
      title: describe(record) + ' was approved',
      body: reviewerLine(hr.employee.full_name, selfReview),
      entityType: 'attendance',
      entityId: id,
    },
  ]);

  return NextResponse.json({ id, status: 'approved', selfReview });
}

/** "Your remote request" / "Your flagged check-in", for a notification title. */
function describe(record: Attendance): string {
  if (record.method === 'remote_request') return 'Your remote check-in request';
  const reason = record.flag_reason
    ? ` (${FLAG_REASON_LABELS[record.flag_reason].toLowerCase()})`
    : '';
  return `Your flagged check-in${reason}`;
}

/**
 * Names the reviewer. A self-review says so outright — the whole point of
 * allowing it is that it stays visible.
 */
function reviewerLine(name: string, self: boolean): string {
  return self
    ? `Reviewed by ${name} — this was their own record.`
    : `Reviewed by ${name}.`;
}

function parseDate(value: unknown): Date | null {
  if (typeof value !== 'string' || !value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function toDate(value: string | null): Date | null {
  return value ? new Date(value) : null;
}
