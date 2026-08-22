import type { SupabaseClient } from '@supabase/supabase-js';
import { hoursWorked } from '@/lib/format';
import type { AttendanceRow } from '@/lib/types';

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
}

export interface ReportEntry {
  id: string;
  employeeName: string;
  employeeEmail: string;
  branchName: string;
  method: AttendanceRow['method'];
  checkInTime: string | null;
  checkOutTime: string | null;
  hours: number | null;
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
       branches:branch_id ( id, name )`,
    )
    .eq('status', 'approved')
    // Verified time is the only time a report knows about.
    .not('check_in_time', 'is', null)
    .gte('check_in_time', filters.from)
    .lte('check_in_time', filters.to)
    .order('check_in_time', { ascending: true });

  if (filters.employeeId) query = query.eq('employee_id', filters.employeeId);
  if (filters.branchId) query = query.eq('branch_id', filters.branchId);

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  const rows = (data ?? []) as unknown as AttendanceRow[];

  const entries: ReportEntry[] = rows.map((row) => ({
    id: row.id,
    employeeName: row.employees?.full_name ?? 'Unknown',
    employeeEmail: row.employees?.email ?? '',
    branchName: row.branches?.name ?? (row.method === 'remote_request' ? 'Remote' : '—'),
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
        e.method === 'qr_gps' ? 'QR + GPS' : 'Remote (approved)',
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
