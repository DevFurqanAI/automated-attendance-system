import { TZ } from '@/lib/format';

/**
 * Leave-request date validation (spec: "Leave timing" — future/today only,
 * per docs/superpowers/specs/2026-08-24-absence-leave-hr-scoping-design.md).
 *
 * Extracted as a pure function so the rule is unit-testable without HTTP
 * plumbing, matching src/lib/attendance/remote-claim.ts. The API route is the
 * only enforcement point that matters — client-side date-picker limits are a
 * convenience.
 */

export type LeaveRangeValidation =
  | { ok: true; fromDate: string; toDate: string }
  | { ok: false; error: string };

/** "Today" in Asia/Karachi as YYYY-MM-DD, independent of the caller's own zone. */
export function todayInTz(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(now);
}

export function validateLeaveRange(
  fromDate: string,
  toDate: string,
  now: Date = new Date(),
): LeaveRangeValidation {
  const dateShape = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateShape.test(fromDate) || !dateShape.test(toDate)) {
    return { ok: false, error: 'Dates must be valid calendar dates.' };
  }

  const today = todayInTz(now);
  if (fromDate < today) {
    return {
      ok: false,
      error: 'Leave cannot be requested for a date that has already passed.',
    };
  }
  if (toDate < fromDate) {
    return { ok: false, error: 'The end date cannot be before the start date.' };
  }

  return { ok: true, fromDate, toDate };
}
