import { Logo } from '@/components/Logo';

/**
 * The signed-out page frame, shared by the pages an emailed auth link can land
 * on. Deliberately the same shape as /login so arriving from an email does not
 * feel like a different product.
 */
export function AuthShell({
  title,
  subtitle,
  children,
  footer,
}: Readonly<{
  title: string;
  subtitle: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}>) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-surface-muted px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <Logo size={64} withWordmark={false} />
          <h1 className="mt-4 text-2xl font-bold tracking-tight text-brand-secondary">
            {title}
          </h1>
          <p className="mt-1.5 text-sm text-ink-muted">{subtitle}</p>
        </div>

        <div className="card p-6">{children}</div>

        {footer && (
          <div className="mt-6 text-center text-xs text-ink-faint">{footer}</div>
        )}
      </div>
    </main>
  );
}
