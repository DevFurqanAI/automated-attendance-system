'use client';

import { useState, type ReactNode } from 'react';
import { buildMonthGrid } from '@/lib/calendarGrid';
import { WEEKDAY_LABELS } from '@/lib/types';

/** Month-navigable 7-column day grid shared by the history and analytics calendar views. */
export function MonthGrid({
  initialMonth,
  renderDay,
}: {
  /** "YYYY-MM" */
  initialMonth: string;
  renderDay: (date: string, inMonth: boolean) => ReactNode;
}) {
  const [ym, setYm] = useState(initialMonth);
  const [year, month] = ym.split('-').map(Number);
  const weeks = buildMonthGrid(year, month - 1);
  const label = new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString(
    'en-US',
    {
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    },
  );

  const shift = (delta: number) => {
    const d = new Date(Date.UTC(year, month - 1 + delta, 1));
    setYm(
      `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`,
    );
  };

  return (
    <div className="mx-auto max-w-xs sm:max-w-sm">
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => shift(-1)}
          className="btn-ghost"
          aria-label="Previous month"
        >
          ‹
        </button>
        <p className="text-sm font-semibold text-ink">{label}</p>
        <button
          type="button"
          onClick={() => shift(1)}
          className="btn-ghost"
          aria-label="Next month"
        >
          ›
        </button>
      </div>
      <div className="mt-3 grid grid-cols-7 gap-1 text-center text-[11px] font-bold uppercase tracking-wide text-ink-faint">
        {WEEKDAY_LABELS.map((d) => (
          <div key={d}>{d}</div>
        ))}
      </div>
      <div className="mt-1 grid grid-cols-7 gap-1">
        {weeks.flatMap((week) =>
          week.map((cell) => (
            <div key={cell.date}>{renderDay(cell.date, cell.inMonth)}</div>
          )),
        )}
      </div>
    </div>
  );
}
