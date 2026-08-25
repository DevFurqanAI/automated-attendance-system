import { formatDate } from '@/lib/format';
import type { BranchHours, DailyTrendPoint } from '@/lib/attendance/report';

/**
 * Validated categorical triple (first three slots of the dataviz skill's
 * reference palette — the only three that clear ALL adjacent-pair CVD/
 * normal-vision floors, not just neighbor-to-neighbor) — see
 * references/palette.md in the dataviz skill. Fixed order, never cycled;
 * status colors (approved/declined/flagged) are deliberately NOT reused
 * here — a status color never doubles as a series (see the skill's
 * non-negotiables).
 */
const SERIES = {
  present: '#2a78d6', // slot 1, blue
  absent: '#eb6834', // slot 2, orange
  leave: '#1baf7a', // slot 3, aqua
} as const;

const CHART_HEIGHT = 200;
const BAR_GAP_PX = 2;

export function DailyTrendChart({ points }: { points: DailyTrendPoint[] }) {
  const max = Math.max(1, ...points.map((p) => p.present + p.absent + p.leave));
  const barWidth = 100 / points.length;
  // Thin every-Nth label so dates never collide, however wide the range.
  const labelEvery = Math.max(1, Math.ceil(points.length / 10));

  return (
    <div className="card p-4">
      <div className="flex items-center justify-between">
        <p className="text-xs font-bold uppercase tracking-wide text-ink-muted">
          Daily attendance
        </p>
        <Legend
          items={[
            { label: 'Present', color: SERIES.present },
            { label: 'Absent', color: SERIES.absent },
            { label: 'Leave', color: SERIES.leave },
          ]}
        />
      </div>

      {points.every((p) => p.present + p.absent + p.leave === 0) ? (
        <p className="mt-6 text-center text-sm text-ink-muted">No data in this range.</p>
      ) : (
        <svg
          viewBox={`0 0 100 ${CHART_HEIGHT + 24}`}
          preserveAspectRatio="none"
          className="mt-3 h-56 w-full"
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
            const segments: { key: string; value: number; color: string }[] = [
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
                    >
                      <title>
                        {formatDate(p.date)} — {seg.key}: {seg.value}
                      </title>
                    </rect>
                  );
                })}
                {total === 0 && (
                  <rect x={x} y={CHART_HEIGHT - 1} width={w} height="1" fill="var(--color-line-strong)" />
                )}
                {i % labelEvery === 0 && (
                  <text
                    x={x + w / 2}
                    y={CHART_HEIGHT + 14}
                    fontSize="3.2"
                    textAnchor="middle"
                    fill="var(--color-ink-faint)"
                  >
                    {formatDate(p.date).replace(/,.*/, '')}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      )}
    </div>
  );
}

export function BranchHoursChart({ rows }: { rows: BranchHours[] }) {
  const max = Math.max(1, ...rows.map((r) => r.hours));

  return (
    <div className="card p-4">
      <p className="text-xs font-bold uppercase tracking-wide text-ink-muted">
        Approved hours by branch
      </p>

      {rows.length === 0 ? (
        <p className="mt-6 text-center text-sm text-ink-muted">No data in this range.</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {rows.map((r) => (
            <li key={r.branchName} className="flex items-center gap-3">
              <span className="w-32 shrink-0 truncate text-sm text-ink" title={r.branchName}>
                {r.branchName}
              </span>
              <span className="h-4 flex-1 overflow-hidden rounded bg-surface-muted">
                <span
                  className="block h-full rounded"
                  style={{
                    width: `${Math.max(2, (r.hours / max) * 100)}%`,
                    backgroundColor: SERIES.present,
                  }}
                  title={`${r.branchName}: ${r.hours.toFixed(1)} h`}
                />
              </span>
              <span className="w-14 shrink-0 text-right text-sm tabular-nums text-ink-muted">
                {r.hours.toFixed(0)}h
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Legend({ items }: { items: { label: string; color: string }[] }) {
  return (
    <ul className="flex flex-wrap gap-3">
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-1.5 text-xs text-ink-muted">
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
