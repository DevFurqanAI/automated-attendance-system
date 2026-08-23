import { Suspense } from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Logo } from '@/components/Logo';
import { LoginForm } from './LoginForm';

export const metadata: Metadata = { title: 'Sign in' };

/**
 * Why an emailed link can drop someone here.
 *
 * Rendered on the server from a code rather than echoed out of the query
 * string: text taken straight from a URL lets a crafted link put a convincing
 * instruction ("your account is locked, call this number") on a page carrying
 * the real logo and the real domain.
 */
const LINK_ERRORS: Record<string, string> = {
  link_invalid:
    'That link has already been used or has expired. Ask your HR administrator for a new one, or reset your password below.',
  link_incomplete:
    'That link is missing part of its address. Open it straight from the email rather than copying it by hand.',
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const linkError = error ? LINK_ERRORS[error] : undefined;

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-surface-muted px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <Logo size={64} withWordmark={false} />
          <h1 className="mt-4 text-2xl font-bold tracking-tight text-brand-secondary">
            Staff Attendance
          </h1>
          <p className="mt-1.5 text-sm text-ink-muted">
            Sign in to check in at your branch.
          </p>
        </div>

        {linkError && (
          <p
            role="alert"
            className="card mb-4 border-l-4 border-status-flagged px-4 py-3 text-sm font-medium text-status-flagged"
          >
            {linkError}
          </p>
        )}

        <div className="card p-6">
          <Suspense fallback={null}>
            <LoginForm />
          </Suspense>

          <p className="mt-4 text-center text-sm">
            <Link
              href="/auth/forgot-password"
              className="font-semibold text-brand-primary"
            >
              Forgot your password?
            </Link>
          </p>
        </div>

        <p className="mt-6 text-center text-xs text-ink-faint">
          Trouble signing in? Contact your HR administrator.
        </p>
      </div>
    </main>
  );
}
