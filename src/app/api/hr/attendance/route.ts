import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { FUTURE_TOLERANCE_MS } from '@/lib/attendance/remote-claim';
import { recordAudit } from '@/lib/audit';
import { isEmployeeVisibleTo } from '@/lib/hr-scope';
import { notify } from '@/lib/notify';
import { createAdminClient, getHrUser, type SessionUser } from '@/lib/supabase/server';
import type { Employee } from '@/lib/types';

/**
 * POST /api/hr/attendance — HR marks one or more employees present directly.
 *
 * For the cases nothing else covers: a phone with no signal all day, a
 * paper sign-in sheet predating this system, or a plain correction where
 * nothing was ever submitted. Lands directly as `approved` — HR creating the
 * record already IS the authorization, so there is no queue to sit in.
 * Always audited ('attendance.hr_create'), one entry per employee.
 *
 * Deliberately creation-only, not an edit path for an existing settled
 * record — see the "re-reviewing a settled record" comment in
 * src/app/api/hr/review/route.ts. A correction to something already on the
 * books is a new, superseding entry, not a silent rewrite of history.
 *
 * Accepts either `employeeId` (single) or `employeeIds` (bulk — e.g. a whole
 * branch present for a training day). The same check-in/check-out/branch/note
 * is applied to every id; per-employee scope failures are reported
 * individually rather than failing the whole batch.
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
    employeeId?: unknown;
    employeeIds?: unknown;
    checkInTime?: unknown;
    checkOutTime?: unknown;
    branchId?: unknown;
    note?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Malformed request.' }, { status: 400 });
  }

  const employeeIds: string[] = Array.isArray(body.employeeIds)
    ? body.employeeIds.filter((v): v is string => typeof v === 'string')
    : typeof body.employeeId === 'string' && body.employeeId
      ? [body.employeeId]
      : [];

  if (employeeIds.length === 0) {
    return NextResponse.json(
      { error: 'employeeId or employeeIds is required.' },
      { status: 400 },
    );
  }

  const checkIn = parseDate(body.checkInTime);
  if (!checkIn) {
    return NextResponse.json(
      { error: 'A valid check-in time is required.' },
      { status: 400 },
    );
  }
  if (checkIn.getTime() > Date.now() + FUTURE_TOLERANCE_MS) {
    return NextResponse.json(
      { error: 'Check-in time cannot be in the future.' },
      { status: 400 },
    );
  }

  let checkOut: Date | null = null;
  if (body.checkOutTime !== undefined && body.checkOutTime !== null && body.checkOutTime !== '') {
    checkOut = parseDate(body.checkOutTime);
    if (!checkOut) {
      return NextResponse.json(
        { error: 'The check-out time is not a valid date.' },
        { status: 400 },
      );
    }
    if (checkOut.getTime() < checkIn.getTime()) {
      return NextResponse.json(
        { error: 'Check-out cannot be before check-in.' },
        { status: 400 },
      );
    }
    if (checkOut.getTime() > Date.now() + FUTURE_TOLERANCE_MS) {
      return NextResponse.json(
        { error: 'Check-out time cannot be in the future.' },
        { status: 400 },
      );
    }
  }

  const branchId =
    typeof body.branchId === 'string' && body.branchId ? body.branchId : null;
  const note = typeof body.note === 'string' ? body.note.trim().slice(0, 500) : '';

  const admin = createAdminClient();

  const results = await Promise.all(
    employeeIds.map((employeeId) =>
      markOnePresent(admin, hr, employeeId, checkIn, checkOut, branchId, note),
    ),
  );

  const failed = results.filter((r) => !r.ok);
  const succeeded = results.filter((r) => r.ok);

  if (employeeIds.length === 1) {
    const only = results[0];
    if (!only.ok) {
      return NextResponse.json({ error: only.error }, { status: only.status });
    }
    return NextResponse.json({
      id: only.id,
      status: 'approved',
      checkInTime: checkIn.toISOString(),
      checkOutTime: checkOut?.toISOString() ?? null,
    });
  }

  return NextResponse.json({
    succeeded: succeeded.length,
    failed: failed.map((f) => ({ employeeId: f.employeeId, error: f.error })),
  });
}

type MarkResult =
  | { ok: true; employeeId: string; id: string }
  | { ok: false; employeeId: string; error: string; status: number };

async function markOnePresent(
  admin: SupabaseClient,
  hr: SessionUser,
  employeeId: string,
  checkIn: Date,
  checkOut: Date | null,
  branchId: string | null,
  note: string,
): Promise<MarkResult> {
  const { data: target } = await admin
    .from('employees')
    .select('*')
    .eq('id', employeeId)
    .single<Employee>();

  if (!target) {
    return { ok: false, employeeId, error: 'Employee not found.', status: 404 };
  }
  if (hr.employee.role !== 'super_admin' && !(await isEmployeeVisibleTo(admin, hr, target))) {
    return {
      ok: false,
      employeeId,
      error: 'This employee is not in one of your assigned branches.',
      status: 403,
    };
  }

  const { data: inserted, error } = await admin
    .from('attendance')
    .insert({
      employee_id: employeeId,
      branch_id: branchId,
      check_in_time: checkIn.toISOString(),
      check_out_time: checkOut?.toISOString() ?? null,
      submitted_at: new Date().toISOString(),
      method: 'hr_manual',
      status: 'approved',
      remote_reason: note || null,
      reviewed_by: hr.id,
      reviewed_at: new Date().toISOString(),
    })
    .select('id')
    .single();

  if (error) {
    return { ok: false, employeeId, error: 'Could not create the record.', status: 500 };
  }

  await recordAudit(admin, hr, {
    action: 'attendance.hr_create',
    entityType: 'attendance',
    entityId: inserted.id,
    subjectId: employeeId,
    detail: {
      check_in_time: checkIn.toISOString(),
      check_out_time: checkOut?.toISOString() ?? null,
      branch_id: branchId,
      note: note || null,
    },
  });

  await notify(admin, [
    {
      recipientId: employeeId,
      kind: 'attendance_approved',
      title: 'HR marked you present',
      body:
        `Recorded by ${hr.employee.full_name}${note ? `: ${note}` : '.'}`.trim(),
      entityType: 'attendance',
      entityId: inserted.id,
    },
  ]);

  return { ok: true, employeeId, id: inserted.id };
}

/**
 * PATCH /api/hr/attendance — HR corrects an attendance record, including an
 * already-settled one.
 *
 * The review endpoint (src/app/api/hr/review/route.ts) deliberately refuses
 * to touch anything outside pending/flagged, "because re-reviewing a settled
 * record would silently rewrite history." This is the escape hatch for when
 * that's exactly what's needed — a mistyped check-out, a wrong branch, an
 * approval that turns out to have been wrong — but it stays honest about it:
 * a reason is mandatory, and every field changed is logged as an explicit
 * before/after pair, never a silent overwrite.
 *
 * employee_id and method are not editable — those are the record's identity.
 * A wrong-employee mistake is a decline-and-recreate (POST, same file), not
 * a correction.
 */
export async function PATCH(request: Request) {
  const hr = await getHrUser();
  if (!hr) {
    return NextResponse.json(
      { error: 'HR administrator access required.' },
      { status: 403 },
    );
  }

  let body: {
    id?: unknown;
    checkInTime?: unknown;
    checkOutTime?: unknown;
    branchId?: unknown;
    status?: unknown;
    reason?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Malformed request.' }, { status: 400 });
  }

  const id = typeof body.id === 'string' ? body.id : '';
  if (!id) {
    return NextResponse.json({ error: 'Missing record id.' }, { status: 400 });
  }

  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
  if (!reason) {
    return NextResponse.json(
      { error: 'A reason is required to edit an attendance record.' },
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

  const { data: record } = await admin
    .from('attendance')
    .select('*')
    .eq('id', id)
    .single<{
      id: string;
      employee_id: string;
      check_in_time: string | null;
      check_out_time: string | null;
      branch_id: string | null;
      status: string;
    }>();

  if (!record) {
    return NextResponse.json({ error: 'Record not found.' }, { status: 404 });
  }

  const { data: target } = await admin
    .from('employees')
    .select('*')
    .eq('id', record.employee_id)
    .single<Employee>();

  if (!target) {
    return NextResponse.json({ error: 'Employee not found.' }, { status: 404 });
  }
  if (hr.employee.role !== 'super_admin' && !(await isEmployeeVisibleTo(admin, hr, target))) {
    return NextResponse.json(
      { error: 'This employee is not in one of your assigned branches.' },
      { status: 403 },
    );
  }

  const update: Record<string, unknown> = {};
  const before: Record<string, unknown> = {};

  if (body.checkInTime !== undefined) {
    const checkIn = parseDate(body.checkInTime);
    if (!checkIn) {
      return NextResponse.json(
        { error: 'The check-in time is not a valid date.' },
        { status: 400 },
      );
    }
    if (checkIn.getTime() > Date.now() + FUTURE_TOLERANCE_MS) {
      return NextResponse.json(
        { error: 'Check-in time cannot be in the future.' },
        { status: 400 },
      );
    }
    before.check_in_time = record.check_in_time;
    update.check_in_time = checkIn.toISOString();
  }

  if (body.checkOutTime !== undefined) {
    const checkOut =
      body.checkOutTime === null || body.checkOutTime === '' ? null : parseDate(body.checkOutTime);
    if (body.checkOutTime !== null && body.checkOutTime !== '' && !checkOut) {
      return NextResponse.json(
        { error: 'The check-out time is not a valid date.' },
        { status: 400 },
      );
    }
    if (checkOut) {
      const checkInForCompare = (update.check_in_time as string | undefined) ?? record.check_in_time;
      if (checkInForCompare && checkOut < new Date(checkInForCompare)) {
        return NextResponse.json(
          { error: 'Check-out cannot be before check-in.' },
          { status: 400 },
        );
      }
      if (checkOut.getTime() > Date.now() + FUTURE_TOLERANCE_MS) {
        return NextResponse.json(
          { error: 'Check-out time cannot be in the future.' },
          { status: 400 },
        );
      }
    }
    before.check_out_time = record.check_out_time;
    update.check_out_time = checkOut?.toISOString() ?? null;
  }

  if (body.branchId !== undefined) {
    before.branch_id = record.branch_id;
    update.branch_id = typeof body.branchId === 'string' && body.branchId ? body.branchId : null;
  }

  if (body.status !== undefined) {
    if (body.status !== 'approved' && body.status !== 'declined') {
      return NextResponse.json(
        { error: 'Status must be "approved" or "declined".' },
        { status: 400 },
      );
    }
    before.status = record.status;
    update.status = body.status;
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: 'Nothing to update.' }, { status: 400 });
  }

  update.reviewed_by = hr.id;
  update.reviewed_at = new Date().toISOString();

  const { error } = await admin.from('attendance').update(update).eq('id', id);

  if (error) {
    return NextResponse.json(
      { error: 'Could not update the record.' },
      { status: 500 },
    );
  }

  await recordAudit(admin, hr, {
    action: 'attendance.hr_edit',
    entityType: 'attendance',
    entityId: id,
    subjectId: record.employee_id,
    detail: { from: before, to: update, reason },
  });

  await notify(admin, [
    {
      recipientId: record.employee_id,
      kind: 'attendance_corrected',
      title: 'One of your attendance records was corrected',
      body: `Corrected by ${hr.employee.full_name}: ${reason}`,
      entityType: 'attendance',
      entityId: id,
    },
  ]);

  return NextResponse.json({ id, ...update });
}

function parseDate(value: unknown): Date | null {
  if (typeof value !== 'string' || !value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}
