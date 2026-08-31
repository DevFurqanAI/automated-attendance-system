/**
 * Static loading-state building blocks for `loading.tsx` files.
 *
 * These render instantly (no data, no client-side fetch) the moment Next.js
 * shows the Suspense fallback for a route segment — they exist purely to fill
 * the screen while the real server-rendered page is still fetching, so they
 * must never trigger a request of their own. `motion-safe:` keeps the pulse
 * off for anyone who has reduced motion turned on.
 */

function Bar({ className = '' }: { className?: string }) {
  return (
    <div
      className={`motion-safe:animate-pulse rounded-[4px] bg-surface-muted ${className}`}
    />
  );
}

export function SkeletonHeader({ withActions = false }: { withActions?: boolean }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <Bar className="h-7 w-48" />
        <Bar className="mt-2 h-4 w-72" />
      </div>
      {withActions && (
        <div className="flex gap-2">
          <Bar className="h-10 w-32" />
          <Bar className="h-10 w-32" />
        </div>
      )}
    </div>
  );
}

export function SkeletonCard({ lines = 3 }: { lines?: number }) {
  return (
    <div className="card p-5">
      <Bar className="h-4 w-24" />
      {Array.from({ length: lines }).map((_, i) => (
        <Bar key={i} className="mt-3 h-4 w-full" />
      ))}
    </div>
  );
}

export function SkeletonCardGrid({ count = 4 }: { count?: number }) {
  return (
    <div className="mt-5 grid gap-3 sm:grid-cols-2">
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonCard key={i} lines={4} />
      ))}
    </div>
  );
}

export function SkeletonStatRow({ count = 3 }: { count?: number }) {
  return (
    <div className="mt-5 grid gap-3 sm:grid-cols-3">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="card p-4">
          <Bar className="h-3 w-20" />
          <Bar className="mt-3 h-7 w-16" />
        </div>
      ))}
    </div>
  );
}

export function SkeletonTable({ rows = 6, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div className="card mt-5 overflow-hidden">
      <div className="flex gap-4 border-b border-line px-4 py-4">
        {Array.from({ length: cols }).map((_, i) => (
          <Bar key={i} className="h-3 w-20" />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex items-center gap-4 border-b border-line px-4 py-4 last:border-0">
          {Array.from({ length: cols }).map((_, c) => (
            <Bar key={c} className="h-4 flex-1" />
          ))}
        </div>
      ))}
    </div>
  );
}

export function SkeletonList({ rows = 5 }: { rows?: number }) {
  return (
    <ul className="mt-5 space-y-2">
      {Array.from({ length: rows }).map((_, i) => (
        <li key={i} className="card flex items-center justify-between gap-4 p-4">
          <Bar className="h-4 w-2/3" />
          <Bar className="h-4 w-16" />
        </li>
      ))}
    </ul>
  );
}

export function SkeletonTabs({ count = 4 }: { count?: number }) {
  return (
    <div className="mt-5 flex gap-4 border-b border-line pb-3">
      {Array.from({ length: count }).map((_, i) => (
        <Bar key={i} className="h-4 w-24" />
      ))}
    </div>
  );
}

export function SkeletonFilters() {
  return (
    <div className="mt-5 flex flex-wrap items-end gap-3">
      <Bar className="h-10 w-56" />
      <Bar className="h-10 w-32" />
      <Bar className="h-10 w-32" />
    </div>
  );
}
