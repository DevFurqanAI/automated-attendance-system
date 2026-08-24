import { NextResponse } from 'next/server';
import { validateLeaveRange } from '@/lib/attendance/leave';
import { notify, scopedHrRecipientIds } from '@/lib/notify';
import { RATE_LIMITS, checkRateLimit, tooManyRequests } from '@/lib/rate-limit';
import { createAdminClient, getSessionUser } from '@/lib/supabase/server';

/**
 * POST /api/attendance/leave — submit a leave request.
 *
 * Creates a `pending` row in leave_requests. Does not touch `attendance` —
 * leave is tracked separately and only affects reporting/absence detection
 * once approved (see is_working_day / mark_daily_absences).
 */
export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });
  }

  let body: { fromDate?: unknown; toDate?: unknown; reason?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Malformed request.' }, { status: 400 });
  }

  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
  if (!reason) {
    return NextResponse.json({ error: 'A reason is required.' }, { status: 400 });
  }
  if (reason.length > 500) {
    return NextResponse.json(
      { error: 'Reason must be 500 characters or fewer.' },
      { status: 400 },
    );
  }

  const fromDate = typeof body.fromDate === 'string' ? body.fromDate : '';
  const toDate = typeof body.toDate === 'string' ? body.toDate : '';

  const validated = validateLeaveRange(fromDate, toDate);
  if (!validated.ok) {
    return NextResponse.json({ error: validated.error }, { status: 400 });
  }

  const admin = createAdminClient();

  if (!(await checkRateLimit(admin, RATE_LIMITS.leave, user.id))) {
    return tooManyRequests(RATE_LIMITS.leave);
  }

  const { data: inserted, error } = await admin
    .from('leave_requests')
    .insert({
      employee_id: user.id,
      from_date: validated.fromDate,
      to_date: validated.toDate,
      reason,
      status: 'pending',
    })
    .select('id, from_date, to_date')
    .single();

  if (error) {
    return NextResponse.json(
      { error: 'Could not submit the leave request. Please try again.' },
      { status: 500 },
    );
  }

  await notify(
    admin,
    (await scopedHrRecipientIds(admin, user.id, user.id)).map((hrId) => ({
      recipientId: hrId,
      kind: 'leave_submitted' as const,
      title: `Leave request from ${user.employee.full_name}`,
      body: `${validated.fromDate} → ${validated.toDate}. ${reason}`,
      entityType: 'leave_request' as const,
      entityId: inserted.id,
    })),
  );

  return NextResponse.json({
    id: inserted.id,
    status: 'pending',
    fromDate: inserted.from_date,
    toDate: inserted.to_date,
  });
}
