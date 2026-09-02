'use client';

import { useState } from 'react';
import { MonthGrid } from '@/components/MonthGrid';
import { formatDate } from '@/lib/format';
import { ATTENDANCE_SERIES } from '@/lib/attendanceColors';
import {
  isOffDay,
  type CalendarDayKind,
} from '@/lib/attendance/workingDay';
import type { DayItem, DayStatus } from '@/lib/attendance/dayStatus';

const STATUS_COLOR: Record<DayStatus, string> = {
  present: ATTENDANCE_SERIES.present,
  leave: ATTENDANCE_SERIES.leave,
  absent: ATTENDANCE_SERIES.absent,
  flagged: 'var(--color-status-flagged)',
  pending: 'var(--color-line-strong)',
  declined: 'var(--color-status-declined)',
};

const STATUS_LABEL: Record<DayStatus, string> = {
  present: 'Present',
  leave: 'Leave',
  absent: 'Absent',
  flagged: 'Flagged',
  pending: 'Pending',
  declined: 'Declined',
};

// Distinct from `pending`'s var(--color-line-strong) so the two read apart
// at a glance: a day off is expected, a pending record is not.
const OFF_COLOR = 'var(--color-ink-faint)';

export function HistoryCalendar({
  initialMonth,
  daysByDate,
  offDays,
  calendarKindByDate,
}: {
  initialMonth: string;
  daysByDate: Record<string, { status: DayStatus; items: DayItem[] }>;
  /** Weekdays (0=Sunday..6=Saturday) this employee is normally off. */
  offDays: number[];
  /** date ("YYYY-MM-DD") -> declared holiday/mandatory-workday override. */
  calendarKindByDate: Record<string, CalendarDayKind>;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const selectedDay = selected ? daysByDate[selected] : null;

  return (
    <div className="card mt-5 p-4">
      <MonthGrid
        initialMonth={initialMonth}
        renderDay={(date, inMonth) => {
          const day = daysByDate[date];
          // A record for the day always wins — an approved check-in on a
          // declared holiday is still shown as Present, not overwritten.
          const off =
            !day && isOffDay(date, offDays, calendarKindByDate[date] ?? null);
          const isSelected = selected === date;
          return (
            <button
              type="button"
              onClick={() => setSelected(isSelected ? null : date)}
              disabled={!inMonth}
              className={`flex aspect-square w-full flex-col items-center justify-center rounded text-sm font-bold ring-brand-secondary ${
                inMonth ? '' : 'opacity-30'
              } ${isSelected ? 'ring-2' : ''}`}
              style={{
                backgroundColor: day
                  ? STATUS_COLOR[day.status]
                  : off
                    ? OFF_COLOR
                    : 'var(--color-surface-muted)',
                color: day || off ? '#fff' : 'var(--color-ink-faint)',
              }}
            >
              {Number(date.slice(8, 10))}
            </button>
          );
        }}
      />

      <div className="mt-3 flex flex-wrap gap-3 text-xs text-ink-muted">
        {(Object.keys(STATUS_LABEL) as DayStatus[]).map((s) => (
          <span key={s} className="flex items-center gap-1.5">
            <span
              aria-hidden
              className="inline-block h-2.5 w-2.5 rounded-sm"
              style={{ backgroundColor: STATUS_COLOR[s] }}
            />
            {STATUS_LABEL[s]}
          </span>
        ))}
        <span className="flex items-center gap-1.5">
          <span
            aria-hidden
            className="inline-block h-2.5 w-2.5 rounded-sm"
            style={{ backgroundColor: OFF_COLOR }}
          />
          Off / holiday
        </span>
      </div>

      {selected && (
        <div className="mt-4 rounded border border-line p-3">
          <p className="text-sm font-semibold text-ink">
            {formatDate(selected)}
          </p>
          {selectedDay ? (
            <ul className="mt-1.5 space-y-1 text-sm text-ink-muted">
              {selectedDay.items.map((item, i) => (
                <li key={i}>
                  {STATUS_LABEL[item.status]} — {item.label}
                </li>
              ))}
            </ul>
          ) : isOffDay(selected, offDays, calendarKindByDate[selected] ?? null) ? (
            <p className="mt-1.5 text-sm text-ink-muted">
              {calendarKindByDate[selected] === 'holiday' ? 'Holiday' : 'Day off'}.
            </p>
          ) : (
            <p className="mt-1.5 text-sm text-ink-muted">
              No record for this day.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
