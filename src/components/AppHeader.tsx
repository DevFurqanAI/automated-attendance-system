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
  hrOnly?: boolean;
}

const NAV: NavItem[] = [
  { href: '/check-in', label: 'Check in' },
  { href: '/remote', label: 'Remote' },
  { href: '/history', label: 'My history' },
  { href: '/hr', label: 'Review', hrOnly: true },
  { href: '/hr/reports', label: 'Reports', hrOnly: true },
  { href: '/hr/branches', label: 'Branches', hrOnly: true },
  { href: '/hr/employees', label: 'Employees', hrOnly: true },
];

export function AppHeader({ name, role }: { name: string; role: Role }) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  const items = NAV.filter((i) => !i.hrOnly || role === 'hr_admin');

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

        <nav className="hidden items-center gap-1 md:flex">
          {items.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              aria-current={isActive(item.href) ? 'page' : undefined}
              className={`px-3 py-2 text-sm font-semibold transition-colors ${
                isActive(item.href)
                  ? 'bg-brand-primary-soft text-brand-primary'
                  : 'text-ink-muted hover:text-ink'
              }`}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="hidden items-center gap-3 md:flex">
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

        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-label="Toggle menu"
          className="btn-secondary px-3 py-2 md:hidden"
        >
          <span aria-hidden>{open ? '✕' : '☰'}</span>
        </button>
      </div>

      {open && (
        <div className="border-t border-line px-4 py-2 md:hidden">
          {items.map((item) => (
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
