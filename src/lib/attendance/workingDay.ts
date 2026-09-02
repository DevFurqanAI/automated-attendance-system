/**
 * Client/server-shared mirror of private.is_working_day() (see
 * 20260824101000_schedule_holidays.sql and 20260825103000_company_wide_calendar.sql)
 * for the parts the calendar UI needs to decide, per rendered day, whether to
 * paint it as "Off / holiday" — without a round trip per cell.
 *
 * Precedence, high to low: a branch-specific calendar entry for the date >
 * the company-wide entry for the date > the employee's own weekly_off_days
 * (if set) else their branch's.
 */

export type CalendarDayKind = 'holiday' | 'mandatory_workday';

/** Employee's own weekly off days win; otherwise inherit the branch's. */
export function resolveOffDays(
  employeeOffDays: number[] | null,
  branchOffDays: number[] | null,
): number[] {
  return employeeOffDays ?? branchOffDays ?? [0];
}

/** True when `dateIso` ("YYYY-MM-DD") should render as a day off. */
export function isOffDay(
  dateIso: string,
  offDays: number[],
  calendarKind: CalendarDayKind | null,
): boolean {
  if (calendarKind === 'mandatory_workday') return false;
  if (calendarKind === 'holiday') return true;

  const weekday = new Date(`${dateIso}T00:00:00Z`).getUTCDay();
  return offDays.includes(weekday);
}

/**
 * Merges branch-specific and company-wide calendar rows into one
 * date -> kind lookup, with the branch-specific entry winning ties.
 */
export function buildCalendarKindByDate(
  rows: { date: string; kind: CalendarDayKind; branch_id: string | null }[],
  branchId: string | null,
): Map<string, CalendarDayKind> {
  const map = new Map<string, CalendarDayKind>();
  for (const row of rows) {
    if (row.branch_id !== null) continue;
    map.set(row.date, row.kind);
  }
  if (branchId) {
    for (const row of rows) {
      if (row.branch_id === branchId) map.set(row.date, row.kind);
    }
  }
  return map;
}
