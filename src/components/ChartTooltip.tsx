'use client';

import { useCallback, useLayoutEffect, useRef, useState } from 'react';

/**
 * Shared hover-tooltip for charts, replacing the browser's native
 * black/white `title` tooltip with one that matches the flat, brand-dark
 * look used everywhere else (see `.card` / brand-secondary in globals.css).
 *
 * Position-tracks the pointer rather than the hovered element, since callers
 * span SVG <rect>s, calendar <div> cells, and HTML bars alike — a single
 * `fixed`-positioned tooltip keyed off clientX/clientY works for all three
 * without per-shape measurement.
 */

type TooltipState = { x: number; y: number; content: React.ReactNode } | null;

export function useChartTooltip() {
  const [tooltip, setTooltip] = useState<TooltipState>(null);

  const showTooltip = useCallback(
    (e: { clientX: number; clientY: number }, content: React.ReactNode) => {
      setTooltip({ x: e.clientX, y: e.clientY, content });
    },
    [],
  );

  const hideTooltip = useCallback(() => setTooltip(null), []);

  return { tooltip, showTooltip, hideTooltip };
}

const EDGE_PADDING = 8;
const CURSOR_GAP = 14;

export function ChartTooltip({ tooltip }: { tooltip: TooltipState }) {
  const ref = useRef<HTMLDivElement | null>(null);
  // Measured after mount so a wide tooltip near a screen edge shifts to stay
  // fully on-screen instead of running off it (the calendar heatmap's rightmost
  // column and the trend chart's first/last bars both sit close to the edge).
  const [offset, setOffset] = useState({ x: 0, flip: false });

  useLayoutEffect(() => {
    if (!tooltip || !ref.current) return;
    const rect = ref.current.getBoundingClientRect();

    const left = tooltip.x - rect.width / 2;
    const right = tooltip.x + rect.width / 2;
    let dx = 0;
    if (left < EDGE_PADDING) dx = EDGE_PADDING - left;
    else if (right > window.innerWidth - EDGE_PADDING) {
      dx = window.innerWidth - EDGE_PADDING - right;
    }

    // Flip below the cursor if there isn't room above it (near the top of
    // the viewport — the first row of a calendar month, e.g.).
    const flip = tooltip.y - rect.height - CURSOR_GAP < EDGE_PADDING;

    setOffset((prev) => (prev.x === dx && prev.flip === flip ? prev : { x: dx, flip }));
  }, [tooltip]);

  if (!tooltip) return null;

  return (
    <div
      ref={ref}
      role="tooltip"
      aria-hidden
      className={`pointer-events-none fixed z-50 -translate-x-1/2 whitespace-nowrap border-t-2 border-brand-primary bg-brand-secondary px-2.5 py-1.5 text-xs font-semibold text-white transition-[left,top] duration-75 ease-out ${
        offset.flip ? 'translate-y-[14px]' : '-translate-y-[calc(100%+14px)]'
      }`}
      style={{
        left: tooltip.x + offset.x,
        top: tooltip.y,
        borderRadius: 'var(--radius-flat)',
      }}
    >
      {tooltip.content}
      <span
        aria-hidden
        className="absolute h-2 w-2 rotate-45 bg-brand-secondary"
        style={
          offset.flip
            ? { top: -4, left: `calc(50% - ${offset.x}px - 4px)` }
            : { bottom: -4, left: `calc(50% - ${offset.x}px - 4px)` }
        }
      />
    </div>
  );
}
