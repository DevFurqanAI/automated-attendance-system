'use client';

import { useState, type ReactNode } from 'react';

/** Toggles between two already-rendered subtrees, handed down as server-rendered children. */
export function HistoryViewTabs({
  table,
  calendar,
}: {
  table: ReactNode;
  calendar: ReactNode;
}) {
  const [view, setView] = useState<'table' | 'calendar'>('table');

  return (
    <div>
      <div className="mt-5 flex gap-1" role="tablist" aria-label="History view">
        <Tab active={view === 'table'} onClick={() => setView('table')}>
          Table
        </Tab>
        <Tab active={view === 'calendar'} onClick={() => setView('calendar')}>
          Calendar
        </Tab>
      </div>
      <div hidden={view !== 'table'}>{table}</div>
      <div hidden={view !== 'calendar'}>{calendar}</div>
    </div>
  );
}

function Tab({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`rounded px-3 py-1.5 text-sm font-semibold transition-colors ${
        active
          ? 'bg-brand-secondary text-white'
          : 'text-ink-muted hover:bg-surface-muted'
      }`}
    >
      {children}
    </button>
  );
}
