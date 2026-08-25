'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';
import { Logo } from '@/components/Logo';
import { createClient } from '@/lib/supabase/client';
import type { Role } from '@/lib/types';

interface NavItem {
  href: string;
  label: string;
}

const PRIMARY_NAV: NavItem[] = [
  { href: '/check-in', label: 'Check in' },
  { href: '/remote', label: 'Remote' },
  { href: '/leave', label: 'Leave' },
  { href: '/history', label: 'My history' },
];

const HR_NAV: NavItem[] = [
  { href: '/hr', label: 'Review' },
  { href: '/hr/reports', label: 'Reports' },
  { href: '/hr/analytics', label: 'Analytics' },
  { href: '/hr/branches', label: 'Branches' },
  { href: '/hr/employees', label: 'Employees' },
  { href: '/hr/audit', label: 'Audit' },
];

/**
 * Bell with an unread count. A link rather than a dropdown: the count is
 * rendered on the server with the rest of the header, so there is no state to
 * keep in sync and it is correct on first paint.
 */
function NotificationBell({ count }: { count: number }) {
  return (
    <Link
      href="/notifications"
      className="relative px-2 py-1.5 text-ink-muted transition-colors hover:text-ink"
      aria-label={
        count > 0 ? `Notifications, ${count} unread` : 'Notifications'
      }
    >
      <span aria-hidden className="text-lg leading-none">
        🔔
      </span>
      {count > 0 && (
        <span
          aria-hidden
          className="absolute -right-0.5 -top-0.5 min-w-4 bg-status-flagged px-1 text-center text-[10px] font-bold leading-4 text-white"
        >
          {count > 9 ? '9+' : count}
        </span>
      )}
    </Link>
  );
}

export function AppHeader({
  name,
  role,
  unreadCount,
}: {
  name: string;
  role: Role;
  unreadCount: number;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [hrMenuOpen, setHrMenuOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  const isHr = role === 'hr_admin' || role === 'super_admin';

  async function signOut() {
    setSigningOut(true);
    await createClient().auth.signOut();
    router.replace('/login');
    router.refresh();
  }

  const isActive = (href: string) =>
    href === '/hr' ? pathname === '/hr' : pathname.startsWith(href);

  return (
    <header className="border-b border-line bg-surface">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
        <Link href="/" aria-label="Home">
          <Logo />
        </Link>

        <nav className="hidden items-center gap-0.5 lg:flex">
          {PRIMARY_NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              aria-current={isActive(item.href) ? 'page' : undefined}
              className={`shrink-0 whitespace-nowrap px-2.5 py-2 text-sm font-semibold transition-colors ${
                isActive(item.href)
                  ? 'bg-brand-primary-soft text-brand-primary'
                  : 'text-ink-muted hover:text-ink'
              }`}
            >
              {item.label}
            </Link>
          ))}

          {isHr && (
            <div className="relative">
              <button
                type="button"
                onClick={() => setHrMenuOpen((v) => !v)}
                aria-expanded={hrMenuOpen}
                className={`shrink-0 whitespace-nowrap px-2.5 py-2 text-sm font-semibold transition-colors ${
                  HR_NAV.some((item) => isActive(item.href))
                    ? 'bg-brand-primary-soft text-brand-primary'
                    : 'text-ink-muted hover:text-ink'
                }`}
              >
                HR ▾
              </button>
              {hrMenuOpen && (
                <div
                  className="absolute left-0 top-full z-20 mt-1 min-w-40 border border-line bg-surface py-1 shadow-lg"
                  onMouseLeave={() => setHrMenuOpen(false)}
                >
                  {HR_NAV.map((item) => (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={() => setHrMenuOpen(false)}
                      className={`block px-3 py-2 text-sm font-semibold ${
                        isActive(item.href)
                          ? 'bg-brand-primary-soft text-brand-primary'
                          : 'text-ink-muted hover:bg-surface-muted hover:text-ink'
                      }`}
                    >
                      {item.label}
                    </Link>
                  ))}
                </div>
              )}
            </div>
          )}
        </nav>

        <div className="hidden shrink-0 items-center gap-3 lg:flex">
          <NotificationBell count={unreadCount} />
          <span className="whitespace-nowrap text-sm text-ink-muted">{name}</span>
          <button
            type="button"
            onClick={signOut}
            disabled={signingOut}
            className="btn-secondary px-3 py-1.5 text-xs"
          >
            Sign out
          </button>
        </div>

        <div className="flex items-center gap-2 lg:hidden">
          <NotificationBell count={unreadCount} />
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-label="Toggle menu"
            className="btn-secondary px-3 py-2"
          >
            <span aria-hidden>{open ? '✕' : '☰'}</span>
          </button>
        </div>
      </div>

      {open && (
        <div className="border-t border-line px-4 py-2 lg:hidden">
          {[...PRIMARY_NAV, ...(isHr ? HR_NAV : [])].map((item) => (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setOpen(false)}
              className={`block px-1 py-2.5 text-sm font-semibold ${
                isActive(item.href) ? 'text-brand-primary' : 'text-ink'
              }`}
            >
              {item.label}
            </Link>
          ))}
          <div className="mt-2 flex items-center justify-between border-t border-line pt-3">
            <span className="text-sm text-ink-muted">{name}</span>
            <button
              type="button"
              onClick={signOut}
              disabled={signingOut}
              className="btn-secondary px-3 py-1.5 text-xs"
            >
              Sign out
            </button>
          </div>
        </div>
      )}
    </header>
  );
}
