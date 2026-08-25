import { TZ } from '@/lib/format';

/**
 * Late-arrival detection — the minimal "shift template" feature: an
 * expected start time, employee-overrides-branch, same precedence shape as
 * weekly_off_days (src/lib/types.ts's WEEKDAY_LABELS neighbor). See
 * 20260825102000_shift_templates.sql.
 *
 * Deliberately not a flag: this is shown on history/reports, never routed
 * into the review queue. detectSpoofing's flags exist to catch fraud; a
 * late arrival is neither fraud nor something requiring HR action, just
 * something worth being able to see.
 */

/** Minutes of grace before a check-in counts as late. */
export const LATE_GRACE_MINUTES = 15;

/** Employee's own expected start time wins; falls back to the branch's. */
export function resolveExpectedStartTime(
  employeeOverride: string | null,
  branchDefault: string | null,
): string | null {
  return employeeOverride ?? branchDefault ?? null;
}

/**
 * Minutes late a check-in was against `expectedStartTime` (a "HH:MM[:SS]"
 * string, evaluated in Asia/Karachi), or null if there's no expectation set
 * or the arrival was within grace. Pure given the ISO instant — the
 * timestamp already carries its own instant in time, so no separate "now"
 * to inject for tests.
 */
export function lateMinutes(
  checkInTimeIso: string,
  expectedStartTime: string | null,
  graceMinutes: number = LATE_GRACE_MINUTES,
): number | null {
  if (!expectedStartTime) return null;

  const [expH, expM] = expectedStartTime.split(':').map(Number);
  if (Number.isNaN(expH) || Number.isNaN(expM)) return null;

  const localTime = new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(checkInTimeIso));
  const [actH, actM] = localTime.split(':').map(Number);

  const expectedMinutes = expH * 60 + expM + graceMinutes;
  const actualMinutes = actH * 60 + actM;
  const late = actualMinutes - expectedMinutes;

  return late > 0 ? late : null;
}
