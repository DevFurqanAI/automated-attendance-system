import { formatTime } from '@/lib/format';
import {
  METHOD_LABELS,
  type Absence,
  type AttendanceRow,
  type LeaveRequest,
} from '@/lib/types';

export type DayStatus =
  'present' | 'leave' | 'absent' | 'flagged' | 'pending' | 'declined';

export interface DayItem {
  status: DayStatus;
  label: string;
}

/** Highest-priority status wins when a day carries more than one record. */
const STATUS_PRIORITY: DayStatus[] = [
  'present',
  'leave',
  'absent',
  'flagged',
  'pending',
  'declined',
];

export function dominantStatus(items: DayItem[]): DayStatus | null {
  for (const s of STATUS_PRIORITY) {
    if (items.some((i) => i.status === s)) return s;
  }
  return null;
}

/** Builds a date -> records map from the same rows the "My history" table renders. */
export function buildDayItems(params: {
  attendance: AttendanceRow[];
  leave: LeaveRequest[];
  absences: Absence[];
}): Map<string, DayItem[]> {
  const map = new Map<string, DayItem[]>();
  const push = (date: string, item: DayItem) => {
    if (!map.has(date)) map.set(date, []);
    map.get(date)!.push(item);
  };

  for (const row of params.attendance) {
    const date = (row.check_in_time ?? row.submitted_at).slice(0, 10);
    const status: DayStatus =
      row.status === 'approved'
        ? 'present'
        : row.status === 'flagged'
          ? 'flagged'
          : row.status === 'declined'
            ? 'declined'
            : 'pending';
    const time = row.check_in_time ?? row.claimed_check_in_time;
    push(date, {
      status,
      label: `${METHOD_LABELS[row.method]}${time ? ` — ${formatTime(time)}` : ''}`,
    });
  }

  for (const lr of params.leave) {
    if (lr.status !== 'approved') continue;
    for (
      let d = new Date(`${lr.from_date}T00:00:00Z`);
      d <= new Date(`${lr.to_date}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() + 1)
    ) {
      push(d.toISOString().slice(0, 10), { status: 'leave', label: 'Leave' });
    }
  }

  for (const a of params.absences) {
    push(a.date, { status: 'absent', label: 'Absent' });
  }

  return map;
}
