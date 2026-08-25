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

/** Sanity cap on a single request's span — a data-quality guard, not a policy limit. */
export const LEAVE_MAX_SPAN_DAYS = 90;

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

  const spanDays =
    (Date.parse(`${toDate}T00:00:00Z`) - Date.parse(`${fromDate}T00:00:00Z`)) /
      86_400_000 +
    1;
  if (spanDays > LEAVE_MAX_SPAN_DAYS) {
    return {
      ok: false,
      error: `A single leave request cannot span more than ${LEAVE_MAX_SPAN_DAYS} days.`,
    };
  }

  return { ok: true, fromDate, toDate };
}

/**
 * Leave-balance tracking (informational, not enforced): how many days of a
 * `from_date`..`to_date` range fall within a given calendar year, clipped at
 * the year boundary for a request that spans New Year's.
 *
 * Deliberately not a submission gate — this codebase's rule throughout is to
 * flag and let a human decide (see detectSpoofing, branch_mismatch) rather
 * than block outright. A balance going negative is something for HR to see
 * on the leave page, not something the API refuses.
 */
export function daysInRangeWithinYear(fromDate: string, toDate: string, year: number): number {
  const yearStart = `${year}-01-01`;
  const yearEnd = `${year}-12-31`;
  const start = fromDate < yearStart ? yearStart : fromDate;
  const end = toDate > yearEnd ? yearEnd : toDate;
  if (end < start) return 0;

  return (
    (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000 + 1
  );
}

/** Total approved leave days an employee has used in `year`. */
export function totalLeaveDaysInYear(
  rows: { from_date: string; to_date: string }[],
  year: number,
): number {
  return rows.reduce((sum, r) => sum + daysInRangeWithinYear(r.from_date, r.to_date, year), 0);
}
