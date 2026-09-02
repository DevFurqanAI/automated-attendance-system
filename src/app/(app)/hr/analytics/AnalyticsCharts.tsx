'use client';

import { useState } from 'react';
import { formatDate } from '@/lib/format';
import { ATTENDANCE_SERIES as SERIES } from '@/lib/attendanceColors';
import { MonthGrid } from '@/components/MonthGrid';
import { ChartTooltip, useChartTooltip } from '@/components/ChartTooltip';
import type { BranchHours, DailyTrendPoint } from '@/lib/attendance/report';

const CHART_HEIGHT = 200;
const BAR_GAP_PX = 2;

export function DailyTrendChart({ points }: { points: DailyTrendPoint[] }) {
  const [view, setView] = useState<'bar' | 'calendar'>('bar');
  const { tooltip, showTooltip, hideTooltip } = useChartTooltip();
  const max = Math.max(1, ...points.map((p) => p.present + p.absent + p.leave));
  const barWidth = 100 / points.length;
  // Thin every-Nth label so dates never collide, however wide the range.
  const labelEvery = Math.max(1, Math.ceil(points.length / 10));
  const empty = points.every((p) => p.present + p.absent + p.leave === 0);

  return (
    <div className="card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-bold uppercase tracking-wide text-ink-muted">
          Daily attendance
        </p>
        <div className="flex items-center gap-3">
          <Legend
            items={[
              { label: 'Present', color: SERIES.present },
              { label: 'Absent', color: SERIES.absent },
              { label: 'Leave', color: SERIES.leave },
            ]}
          />
          <div
            className="flex gap-1"
            role="tablist"
            aria-label="Daily attendance view"
          >
            <ViewTab active={view === 'bar'} onClick={() => setView('bar')}>
              Bar
            </ViewTab>
            <ViewTab
              active={view === 'calendar'}
              onClick={() => setView('calendar')}
            >
              Calendar
            </ViewTab>
          </div>
        </div>
      </div>

      {empty ? (
        <p className="mt-6 text-center text-sm text-ink-muted">
          No data in this range.
        </p>
      ) : view === 'calendar' ? (
        <TrendCalendar points={points} />
      ) : (
        <>
          <svg
            viewBox={`0 0 100 ${CHART_HEIGHT}`}
            preserveAspectRatio="none"
            className="mt-3 h-48 w-full"
            role="img"
            aria-label="Daily present, absent, and leave counts"
          >
            {/* Recessive baseline */}
            <line
              x1="0"
              y1={CHART_HEIGHT}
              x2="100"
              y2={CHART_HEIGHT}
              stroke="var(--color-line)"
              strokeWidth="0.3"
            />
            {points.map((p, i) => {
              const x = i * barWidth + BAR_GAP_PX / 20;
              const w = Math.max(0, barWidth - BAR_GAP_PX / 10);
              const total = p.present + p.absent + p.leave;
              const scale = (n: number) => (n / max) * (CHART_HEIGHT - 8);

              let yCursor = CHART_HEIGHT;
              const segments: { key: string; value: number; color: string }[] =
                [
                  { key: 'present', value: p.present, color: SERIES.present },
                  { key: 'absent', value: p.absent, color: SERIES.absent },
                  { key: 'leave', value: p.leave, color: SERIES.leave },
                ];

              return (
                <g key={p.date}>
                  {segments.map((seg) => {
                    if (seg.value === 0) return null;
                    const h = scale(seg.value);
                    yCursor -= h;
                    return (
                      <rect
                        key={seg.key}
                        x={x}
                        y={yCursor}
                        width={w}
                        height={h}
                        rx="0.6"
                        fill={seg.color}
                        onMouseEnter={(e) =>
                          showTooltip(
                            e,
                            <>
                              {formatDate(p.date)} —{' '}
                              <span className="capitalize">{seg.key}</span>:{' '}
                              {seg.value}
                            </>,
                          )
                        }
                        onMouseMove={(e) =>
                          showTooltip(
                            e,
                            <>
                              {formatDate(p.date)} —{' '}
                              <span className="capitalize">{seg.key}</span>:{' '}
                              {seg.value}
                            </>,
                          )
                        }
                        onMouseLeave={hideTooltip}
                      />
                    );
                  })}
                  {total === 0 && (
                    <rect
                      x={x}
                      y={CHART_HEIGHT - 1}
                      width={w}
                      height="1"
                      fill="var(--color-line-strong)"
                    />
                  )}
                </g>
              );
            })}
          </svg>

          {/*
           * Rendered as plain HTML rather than SVG <text>: the chart's
           * preserveAspectRatio="none" stretches its viewBox non-uniformly
           * (much more horizontally than vertically) to fill a wide,
           * non-square container, which squashed in-SVG labels into an
           * unreadable sliver. HTML text isn't subject to that scaling.
           */}
          <div className="mt-1 flex text-[10px] text-ink-faint" aria-hidden>
            {points.map((p, i) => (
              <div
                key={p.date}
                style={{ width: `${barWidth}%` }}
                className="text-center"
              >
                {i % labelEvery === 0
                  ? formatDate(p.date).replace(/,.*/, '')
                  : ''}
              </div>
            ))}
          </div>
        </>
      )}

      <ChartTooltip tooltip={tooltip} />
    </div>
  );
}

function ViewTab({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`rounded px-2 py-1 text-xs font-semibold transition-colors ${
        active
          ? 'bg-brand-secondary text-white'
          : 'text-ink-muted hover:bg-surface-muted'
      }`}
    >
      {children}
    </button>
  );
}

/** Month-grid heatmap over the same `points` the bar chart uses — no extra queries. */
function TrendCalendar({ points }: { points: DailyTrendPoint[] }) {
  const byDate = new Map(points.map((p) => [p.date, p]));
  const initialMonth = points[points.length - 1].date.slice(0, 7);
  const max = Math.max(1, ...points.map((p) => p.present + p.absent + p.leave));
  const { tooltip, showTooltip, hideTooltip } = useChartTooltip();

  return (
    <div className="mt-3">
      <MonthGrid
        initialMonth={initialMonth}
        renderDay={(date, inMonth) => {
          const p = byDate.get(date);
          if (!inMonth || !p) {
            return <div className="aspect-square rounded" />;
          }
          const total = p.present + p.absent + p.leave;
          const dominant =
            total === 0
              ? null
              : (['present', 'absent', 'leave'] as const).reduce((a, b) =>
                  p[b] > p[a] ? b : a,
                );
          const content = (
            <>
              {formatDate(date)} — present: {p.present}, absent: {p.absent},
              leave: {p.leave}
            </>
          );

          return (
            <div
              className="flex aspect-square flex-col items-center justify-center rounded text-sm font-bold"
              style={{
                backgroundColor: dominant
                  ? SERIES[dominant]
                  : 'var(--color-surface-muted)',
                opacity: dominant ? Math.max(0.25, total / max) : 1,
                color: dominant ? '#fff' : 'var(--color-ink-faint)',
              }}
              onMouseEnter={(e) => showTooltip(e, content)}
              onMouseMove={(e) => showTooltip(e, content)}
              onMouseLeave={hideTooltip}
            >
              {Number(date.slice(8, 10))}
            </div>
          );
        }}
      />
      <ChartTooltip tooltip={tooltip} />
    </div>
  );
}

export function BranchHoursChart({ rows }: { rows: BranchHours[] }) {
  const max = Math.max(1, ...rows.map((r) => r.hours));
  const { tooltip, showTooltip, hideTooltip } = useChartTooltip();

  return (
    <div className="card p-4">
      <p className="text-xs font-bold uppercase tracking-wide text-ink-muted">
        Approved hours by branch
      </p>

      {rows.length === 0 ? (
        <p className="mt-6 text-center text-sm text-ink-muted">
          No data in this range.
        </p>
      ) : (
        <ul className="mt-3 space-y-2">
          {rows.map((r) => (
            <li key={r.branchName} className="flex items-center gap-3">
              <span
                className="w-32 shrink-0 truncate text-sm text-ink"
                onMouseEnter={(e) => showTooltip(e, r.branchName)}
                onMouseMove={(e) => showTooltip(e, r.branchName)}
                onMouseLeave={hideTooltip}
              >
                {r.branchName}
              </span>
              <span className="h-4 flex-1 overflow-hidden rounded bg-surface-muted">
                <span
                  className="block h-full rounded"
                  style={{
                    width: `${Math.max(2, (r.hours / max) * 100)}%`,
                    backgroundColor: SERIES.present,
                  }}
                  onMouseEnter={(e) =>
                    showTooltip(e, `${r.branchName}: ${r.hours.toFixed(1)} h`)
                  }
                  onMouseMove={(e) =>
                    showTooltip(e, `${r.branchName}: ${r.hours.toFixed(1)} h`)
                  }
                  onMouseLeave={hideTooltip}
                />
              </span>
              <span className="w-14 shrink-0 text-right text-sm tabular-nums text-ink-muted">
                {r.hours.toFixed(0)}h
              </span>
            </li>
          ))}
        </ul>
      )}

      <ChartTooltip tooltip={tooltip} />
    </div>
  );
}

function Legend({ items }: { items: { label: string; color: string }[] }) {
  return (
    <ul className="flex flex-wrap gap-3">
      {items.map((item) => (
        <li
          key={item.label}
          className="flex items-center gap-1.5 text-xs text-ink-muted"
        >
          <span
            aria-hidden
            className="inline-block h-2.5 w-2.5 rounded-sm"
            style={{ backgroundColor: item.color }}
          />
          {item.label}
        </li>
      ))}
    </ul>
  );
}
