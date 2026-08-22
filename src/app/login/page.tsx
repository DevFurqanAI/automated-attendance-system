import { Suspense } from 'react';
import type { Metadata } from 'next';
import { Logo } from '@/components/Logo';
import { LoginForm } from './LoginForm';

export const metadata: Metadata = { title: 'Sign in' };

export default function LoginPage() {
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

        <div className="card p-6">
          <Suspense fallback={null}>
            <LoginForm />
          </Suspense>
        </div>

        <p className="mt-6 text-center text-xs text-ink-faint">
          Trouble signing in? Contact your HR administrator.
        </p>
      </div>
    </main>
  );
}
