import type { SupabaseClient } from '@supabase/supabase-js';
import { hoursWorked } from '@/lib/format';
import { METHOD_LABELS, type AttendanceRow } from '@/lib/types';

/**
 * Attendance reporting (spec §7.6).
 *
 * Reports read ONLY `check_in_time` / `check_out_time` and ONLY rows with
 * status `approved`. A claim that HR has not approved has null verified times
 * and a non-approved status, so it cannot reach a total by either route.
 */

export interface ReportFilters {
  from: string;
  to: string;
  employeeId?: string | null;
  branchId?: string | null;
  /**
   * Restricts results to this set of employee ids — set by the caller for a
   * scoped hr_admin querying through the service-role client, which bypasses
   * the RLS policy that would otherwise enforce this. `null`/`undefined`
   * means unrestricted (super_admin, or a caller already scoped by RLS).
   */
  employeeIds?: string[] | null;
}

export interface ReportEntry {
  id: string;
  employeeName: string;
  employeeEmail: string;
  branchName: string;
  branchId: string | null;
  method: AttendanceRow['method'];
  checkInTime: string | null;
  checkOutTime: string | null;
  hours: number | null;
  /** Set only when the shift was closed at a different branch. */
  checkOutBranchName?: string | null;
  remoteReason: string | null;
}

export interface ReportTotals {
  entries: number;
  hours: number;
  openShifts: number;
}

export async function loadReport(
  supabase: SupabaseClient,
  filters: ReportFilters,
): Promise<{ entries: ReportEntry[]; totals: ReportTotals }> {
  let query = supabase
    .from('attendance')
    .select(
      `id, method, check_in_time, check_out_time, remote_reason,
       employees:employee_id ( id, full_name, email ),
       branches:branch_id ( id, name ),
       checkout_branch:check_out_branch_id ( id, name )`,
    )
    .eq('status', 'approved')
    // Verified time is the only time a report knows about.
    .not('check_in_time', 'is', null)
    .gte('check_in_time', filters.from)
    .lte('check_in_time', filters.to)
    .order('check_in_time', { ascending: false });

  if (filters.employeeId) query = query.eq('employee_id', filters.employeeId);
  if (filters.branchId) query = query.eq('branch_id', filters.branchId);
  if (filters.employeeIds) query = query.in('employee_id', filters.employeeIds);

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  const rows = (data ?? []) as unknown as AttendanceRow[];

  const entries: ReportEntry[] = rows.map((row) => ({
    id: row.id,
    employeeName: row.employees?.full_name ?? 'Unknown',
    employeeEmail: row.employees?.email ?? '',
    branchName: row.branches?.name ?? (row.method === 'qr_gps' ? '—' : METHOD_LABELS[row.method]),
    branchId: row.branch_id ?? null,
    // Only carried when the shift closed somewhere else — an ordinary shift
    // would just repeat the branch column for every row.
    checkOutBranchName:
      row.checkout_branch && row.checkout_branch.id !== row.branch_id
        ? row.checkout_branch.name
        : null,
    method: row.method,
    checkInTime: row.check_in_time,
    checkOutTime: row.check_out_time,
    hours: hoursWorked(row.check_in_time, row.check_out_time),
    remoteReason: row.remote_reason,
  }));

  const totals: ReportTotals = {
    entries: entries.length,
    hours: entries.reduce((sum, e) => sum + (e.hours ?? 0), 0),
    openShifts: entries.filter((e) => e.hours == null).length,
  };

  return { entries, totals };
}

export interface AttendanceSummaryRow {
  employeeId: string;
  employeeName: string;
  present: number;
  absent: number;
  leave: number;
  holidayOrOff: number;
}

/**
 * Per-employee day counts over the range: how many days were spent present,
 * absent, on leave, or off (weekend/holiday) — the picture "hours worked"
 * alone can't give. Iterates one is_working_day() call per employee-day
 * rather than a single SQL aggregate, matching the resolver's own
 * per-employee/per-date shape (branch_id / weekly_off_days come from the
 * employee row it looks up internally).
 */
export async function loadAttendanceSummary(
  supabase: SupabaseClient,
  filters: ReportFilters,
): Promise<AttendanceSummaryRow[]> {
  let employeeQuery = supabase.from('employees').select('id, full_name').eq('active', true);

  if (filters.employeeId) employeeQuery = employeeQuery.eq('id', filters.employeeId);
  if (filters.branchId) employeeQuery = employeeQuery.eq('default_branch_id', filters.branchId);
  if (filters.employeeIds) employeeQuery = employeeQuery.in('id', filters.employeeIds);
  const { data: employees, error: employeesError } = await employeeQuery.returns<
    { id: string; full_name: string }[]
  >();
  if (employeesError) throw new Error(employeesError.message);

  const fromDate = filters.from.slice(0, 10);
  const toDate = filters.to.slice(0, 10);
  const dates: string[] = [];
  for (
    let d = new Date(`${fromDate}T00:00:00Z`);
    d <= new Date(`${toDate}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 1)
  ) {
    dates.push(d.toISOString().slice(0, 10));
  }

  const results: AttendanceSummaryRow[] = [];

  for (const employee of employees ?? []) {
    const [{ data: attendanceDates }, { data: leaveRows }, { data: absenceRows }] = await Promise.all([
      supabase
        .from('attendance')
        .select('check_in_time')
        .eq('employee_id', employee.id)
        .gte('check_in_time', `${fromDate}T00:00:00Z`)
        .lte('check_in_time', `${toDate}T23:59:59Z`)
        .not('check_in_time', 'is', null)
        .returns<{ check_in_time: string }[]>(),
      supabase
        .from('leave_requests')
        .select('from_date, to_date')
        .eq('employee_id', employee.id)
        .eq('status', 'approved')
        .lte('from_date', toDate)
        .gte('to_date', fromDate)
        .returns<{ from_date: string; to_date: string }[]>(),
      supabase
        .from('absences')
        .select('date')
        .eq('employee_id', employee.id)
        .gte('date', fromDate)
        .lte('date', toDate)
        .returns<{ date: string }[]>(),
    ]);

    const presentDates = new Set(
      (attendanceDates ?? []).map((a) => a.check_in_time.slice(0, 10)),
    );
    const leaveDates = new Set(
      dates.filter((date) =>
        (leaveRows ?? []).some((l) => date >= l.from_date && date <= l.to_date),
      ),
    );
    const absentDates = new Set((absenceRows ?? []).map((a) => a.date));

    let present = 0;
    let absent = 0;
    let leave = 0;
    let holidayOrOff = 0;

    for (const date of dates) {
      if (presentDates.has(date)) {
        present += 1;
      } else if (leaveDates.has(date)) {
        leave += 1;
      } else if (absentDates.has(date)) {
        absent += 1;
      } else {
        // Neither present, on leave, nor marked absent — a weekend/holiday,
        // or (for today/future dates within the range) simply not yet
        // reconciled by the nightly job.
        holidayOrOff += 1;
      }
    }

    results.push({
      employeeId: employee.id,
      employeeName: employee.full_name,
      present,
      absent,
      leave,
      holidayOrOff,
    });
  }

  return results;
}

/**
 * RFC 4180 CSV.
 *
 * Fields are also guarded against spreadsheet formula injection: a value
 * starting with = + - or @ is prefixed with a single quote, so a crafted
 * "remote reason" cannot execute when HR opens the export in Excel.
 */
export function toCsv(entries: ReportEntry[]): string {
  const header = [
    'Employee',
    'Email',
    'Branch',
    'Checked out at',
    'Method',
    'Check in',
    'Check out',
    'Hours worked',
    'Remote reason',
  ];

  const lines = [header.map(csvCell).join(',')];

  for (const e of entries) {
    lines.push(
      [
        e.employeeName,
        e.employeeEmail,
        e.branchName,
        e.checkOutBranchName ?? '',
        METHOD_LABELS[e.method],
        e.checkInTime ?? '',
        e.checkOutTime ?? '',
        e.hours == null ? '' : e.hours.toFixed(2),
        e.remoteReason ?? '',
      ]
        .map(csvCell)
        .join(','),
    );
  }

  return `${lines.join('\r\n')}\r\n`;
}

function csvCell(value: string): string {
  let v = value ?? '';
  if (/^[=+\-@\t\r]/.test(v)) v = `'${v}`;
  if (/[",\r\n]/.test(v)) v = `"${v.replace(/"/g, '""')}"`;
  return v;
}
