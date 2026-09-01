'use client';

import { useState } from 'react';
import { MonthGrid } from '@/components/MonthGrid';
import { formatDate } from '@/lib/format';
import { ATTENDANCE_SERIES } from '@/lib/attendanceColors';
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

export function HistoryCalendar({
  initialMonth,
  daysByDate,
}: {
  initialMonth: string;
  daysByDate: Record<string, { status: DayStatus; items: DayItem[] }>;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const selectedDay = selected ? daysByDate[selected] : null;

  return (
    <div className="card mt-5 p-4">
      <MonthGrid
        initialMonth={initialMonth}
        renderDay={(date, inMonth) => {
          const day = daysByDate[date];
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
                  : 'var(--color-surface-muted)',
                color: day ? '#fff' : 'var(--color-ink-faint)',
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
