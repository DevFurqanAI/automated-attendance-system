import type { Metadata } from 'next';
import { lateMinutes, resolveExpectedStartTime } from '@/lib/attendance/lateness';
import { StatusBadge } from '@/components/StatusBadge';
import {
  formatDate,
  formatDuration,
  formatTime,
  hoursWorked,
} from '@/lib/format';
import { createClient, getSessionUser } from '@/lib/supabase/server';
import {
  FLAG_REASON_LABELS,
  METHOD_LABELS,
  type Absence,
  type AttendanceRow,
  type LeaveRequest,
} from '@/lib/types';
import { DisputeButton } from './DisputeButton';

export const metadata: Metadata = { title: 'My history' };

type HistoryEntry =
  | { kind: 'attendance'; date: string; row: AttendanceRow }
  | { kind: 'leave'; date: string; row: LeaveRequest }
  | { kind: 'absence'; date: string; row: Absence };

export default async function HistoryPage() {
  const user = (await getSessionUser())!;
  const supabase = await createClient();

  const [{ data }, { data: leaveRows }, { data: absenceRows }, { data: openDisputes }, { data: branchStarts }] =
    await Promise.all([
      supabase
        .from('attendance')
        .select('*, branches:branch_id ( id, name ), employees:employee_id ( id, full_name, email )')
        .eq('employee_id', user.id)
        .order('submitted_at', { ascending: false })
        .limit(100)
        .returns<AttendanceRow[]>(),
      supabase
        .from('leave_requests')
        .select('*')
        .eq('employee_id', user.id)
        .order('from_date', { ascending: false })
        .limit(100)
        .returns<LeaveRequest[]>(),
      supabase
        .from('absences')
        .select('*')
        .eq('employee_id', user.id)
        .order('date', { ascending: false })
        .limit(100)
        .returns<Absence[]>(),
      supabase
        .from('disputes')
        .select('attendance_id')
        .eq('employee_id', user.id)
        .eq('status', 'open')
        .returns<{ attendance_id: string }[]>(),
      supabase
        .from('branches_public')
        .select('id, expected_start_time')
        .returns<{ id: string; expected_start_time: string | null }[]>(),
    ]);

  const disputedIds = new Set((openDisputes ?? []).map((d) => d.attendance_id));
  const branchStartById = new Map(
    (branchStarts ?? []).map((b) => [b.id, b.expected_start_time]),
  );

  const rows = data ?? [];

  const approvedHours = rows
    .filter((r) => r.status === 'approved')
    .reduce((sum, r) => sum + (hoursWorked(r.check_in_time, r.check_out_time) ?? 0), 0);

  const entries: HistoryEntry[] = [
    ...rows.map((row): HistoryEntry => ({
      kind: 'attendance',
      date: row.check_in_time ?? row.submitted_at,
      row,
    })),
    ...(leaveRows ?? []).map((row): HistoryEntry => ({
      kind: 'leave',
      date: row.from_date,
      row,
    })),
    ...(absenceRows ?? []).map((row): HistoryEntry => ({
      kind: 'absence',
      date: row.date,
      row,
    })),
  ].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-brand-secondary">
            My attendance
          </h1>
          <p className="mt-1.5 text-sm text-ink-muted">
            Your last {entries.length} records.
          </p>
        </div>
        <div className="text-right">
          <p className="text-xs font-bold uppercase tracking-wide text-ink-muted">
            Approved hours shown
          </p>
          <p className="text-2xl font-bold tabular-nums text-brand-secondary">
            {formatDuration(approvedHours)}
          </p>
        </div>
      </div>

      {entries.length === 0 ? (
        <p className="card mt-5 p-8 text-center text-ink-muted">
          No attendance recorded yet. Scan your branch QR code to check in.
        </p>
      ) : (
        <div className="card mt-5 overflow-x-auto">
          <table className="w-full min-w-[46rem] border-collapse text-sm">
            <thead>
              <tr className="border-b border-line text-left">
                <Th>Date</Th>
                <Th>Branch</Th>
                <Th>In</Th>
                <Th>Out</Th>
                <Th>Hours</Th>
                <Th>Method</Th>
                <Th>Status</Th>
                <Th>&nbsp;</Th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => {
                if (entry.kind === 'leave') {
                  const leave = entry.row;
                  return (
                    <tr key={`leave-${leave.id}`} className="border-b border-line last:border-0">
                      <Td>{formatDate(leave.from_date)}</Td>
                      <Td colSpan={4}>
                        Leave
                        {leave.to_date !== leave.from_date
                          ? ` (through ${formatDate(leave.to_date)})`
                          : ''}
                      </Td>
                      <Td>—</Td>
                      <Td>
                        <StatusBadge status={leave.status} />
                      </Td>
                      <Td>—</Td>
                    </tr>
                  );
                }

                if (entry.kind === 'absence') {
                  const absence = entry.row;
                  return (
                    <tr key={`absence-${absence.id}`} className="border-b border-line last:border-0">
                      <Td>{formatDate(absence.date)}</Td>
                      <Td colSpan={4}>Absent — no check-in and no approved leave</Td>
                      <Td>—</Td>
                      <Td>
                        <span className="badge bg-status-declined-bg text-status-declined">
                          Absent
                        </span>
                      </Td>
                      <Td>—</Td>
                    </tr>
                  );
                }

                const row = entry.row;
                const remote = row.method === 'remote_request';
                // A pending/declined remote request has no verified time yet —
                // show what was claimed, clearly labelled as a claim.
                const showClaim = remote && !row.check_in_time;
                const inTime = showClaim
                  ? row.claimed_check_in_time
                  : row.check_in_time;
                const outTime = showClaim
                  ? row.claimed_check_out_time
                  : row.check_out_time;

                const late =
                  row.check_in_time && !showClaim
                    ? lateMinutes(
                        row.check_in_time,
                        resolveExpectedStartTime(
                          user.employee.expected_start_time,
                          row.branch_id ? (branchStartById.get(row.branch_id) ?? null) : null,
                        ),
                      )
                    : null;

                return (
                  <tr key={row.id} className="border-b border-line last:border-0">
                    <Td>{formatDate(inTime ?? row.submitted_at)}</Td>
                    <Td>{row.branches?.name ?? (row.method === 'qr_gps' ? '—' : METHOD_LABELS[row.method])}</Td>
                    <Td>
                      {formatTime(inTime)}
                      {showClaim && <ClaimTag />}
                      {late != null && (
                        <span className="ml-1.5 text-xs font-semibold text-status-flagged">
                          Late {late}m
                        </span>
                      )}
                    </Td>
                    <Td>{formatTime(outTime)}</Td>
                    <Td className="tabular-nums">
                      {formatDuration(
                        hoursWorked(row.check_in_time, row.check_out_time),
                      )}
                    </Td>
                    <Td>{METHOD_LABELS[row.method]}</Td>
                    <Td>
                      <StatusBadge status={row.status} />
                      {row.flag_reason && (
                        <span className="mt-1 block text-xs text-ink-muted">
                          {FLAG_REASON_LABELS[row.flag_reason]}
                        </span>
                      )}
                    </Td>
                    <Td>
                      <DisputeButton
                        attendanceId={row.id}
                        hasOpenDispute={disputedIds.has(row.id)}
                      />
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="px-4 py-3 text-xs font-bold uppercase tracking-wide text-ink-muted">
      {children}
    </th>
  );
}

function Td({
  children,
  className = '',
  colSpan,
}: {
  children: React.ReactNode;
  className?: string;
  colSpan?: number;
}) {
  return (
    <td className={`px-4 py-3 align-top ${className}`} colSpan={colSpan}>
      {children}
    </td>
  );
}

function ClaimTag() {
  return (
    <span className="ml-1.5 text-xs font-semibold text-ink-faint">claimed</span>
  );
}
