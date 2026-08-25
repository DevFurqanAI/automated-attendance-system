import { NextResponse } from 'next/server';
import { notify, scopedHrRecipientIds } from '@/lib/notify';
import { RATE_LIMITS, checkRateLimit, tooManyRequests } from '@/lib/rate-limit';
import { createAdminClient, getSessionUser } from '@/lib/supabase/server';
import type { Attendance } from '@/lib/types';

/**
 * POST /api/attendance/disputes — an employee flags one of their own
 * attendance records as wrong.
 *
 * The formal channel for "I think my check-out time is wrong" — previously
 * an informal message to HR, with no record of it anywhere. Filing a dispute
 * does NOT change the underlying record; it opens a separate queue item HR
 * reviews and resolves, correcting the record themselves (PATCH
 * /api/hr/attendance) if it turns out to be warranted — see
 * 20260825101000_disputes.sql for why this stays a separate table rather
 * than another attendance.status value.
 */
export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });
  }

  let body: { attendanceId?: unknown; reason?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Malformed request.' }, { status: 400 });
  }

  const attendanceId = typeof body.attendanceId === 'string' ? body.attendanceId : '';
  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';

  if (!attendanceId) {
    return NextResponse.json({ error: 'attendanceId is required.' }, { status: 400 });
  }
  if (!reason) {
    return NextResponse.json({ error: 'A reason is required.' }, { status: 400 });
  }
  if (reason.length > 500) {
    return NextResponse.json(
      { error: 'Reason must be 500 characters or fewer.' },
      { status: 400 },
    );
  }

  const admin = createAdminClient();

  if (!(await checkRateLimit(admin, RATE_LIMITS.dispute, user.id))) {
    return tooManyRequests(RATE_LIMITS.dispute);
  }

  const { data: record } = await admin
    .from('attendance')
    .select('id, employee_id')
    .eq('id', attendanceId)
    .single<Pick<Attendance, 'id' | 'employee_id'>>();

  if (!record || record.employee_id !== user.id) {
    return NextResponse.json({ error: 'Record not found.' }, { status: 404 });
  }

  const { data: existing } = await admin
    .from('disputes')
    .select('id')
    .eq('attendance_id', attendanceId)
    .eq('status', 'open')
    .maybeSingle();

  if (existing) {
    return NextResponse.json(
      { error: 'This record already has an open dispute.' },
      { status: 409 },
    );
  }

  const { data: inserted, error } = await admin
    .from('disputes')
    .insert({ attendance_id: attendanceId, employee_id: user.id, reason })
    .select('id')
    .single();

  if (error) {
    return NextResponse.json(
      { error: 'Could not submit the dispute. Please try again.' },
      { status: 500 },
    );
  }

  await notify(
    admin,
    (await scopedHrRecipientIds(admin, user.id, user.id)).map((hrId) => ({
      recipientId: hrId,
      kind: 'dispute_submitted' as const,
      title: `${user.employee.full_name} disputed an attendance record`,
      body: reason,
      entityType: 'attendance' as const,
      entityId: attendanceId,
    })),
  );

  return NextResponse.json({ id: inserted.id, status: 'open' });
}
