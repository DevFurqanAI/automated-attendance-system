'use client';

import { useId, useRef, useState } from 'react';

export interface RowMenuAction {
  label: string;
  onClick?: () => void;
  href?: string;
  danger?: boolean;
  disabled?: boolean;
}

/**
 * Overflow menu for a table row's less-common actions. Uses the native
 * popover API rather than `position: absolute` so it renders in the
 * top layer — the table's `overflow-x-auto` wrapper can't clip it.
 */
export function RowActionsMenu({ label, actions }: { label: string; actions: RowMenuAction[] }) {
  const menuId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [style, setStyle] = useState<React.CSSProperties>();

  function place() {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const menuWidth = 208;
    const left = Math.max(8, Math.min(rect.right - menuWidth, window.innerWidth - menuWidth - 8));
    setStyle({ position: 'fixed', top: rect.bottom + 4, left, margin: 0 });
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        popoverTarget={menuId}
        aria-label={`More actions for ${label}`}
        className="btn-ghost btn-sm"
        onClick={place}
      >
        More<span aria-hidden="true">▾</span>
      </button>
      <div
        id={menuId}
        popover="auto"
        className="card min-w-[13rem] p-1"
        style={style}
        onToggle={(e) => {
          if ((e as React.ToggleEvent<HTMLDivElement>).newState === 'open') place();
        }}
      >
        {actions.map((action) =>
          action.href ? (
            <a
              key={action.label}
              href={action.href}
              download
              className="block px-3 py-2 text-left text-sm text-ink hover:bg-surface-muted"
            >
              {action.label}
            </a>
          ) : (
            <button
              key={action.label}
              type="button"
              disabled={action.disabled}
              className={`block w-full px-3 py-2 text-left text-sm hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-50 ${
                action.danger ? 'text-status-flagged' : 'text-ink'
              }`}
              popoverTarget={menuId}
              popoverTargetAction="hide"
              onClick={action.onClick}
            >
              {action.label}
            </button>
          ),
        )}
      </div>
    </>
  );
}
