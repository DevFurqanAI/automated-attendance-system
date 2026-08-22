import { redirect } from 'next/navigation';
import { AppHeader } from '@/components/AppHeader';
import { getSessionUser } from '@/lib/supabase/server';

/**
 * Shell for every signed-in page. The middleware already redirects anonymous
 * requests, but this re-checks server-side so a deactivated employee (whose
 * JWT is still valid) also loses access.
 */
export default async function AppLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const user = await getSessionUser();
  if (!user) redirect('/login');

  return (
    <div className="min-h-dvh">
      <AppHeader name={user.employee.full_name} role={user.employee.role} />
      <main className="mx-auto max-w-6xl px-4 py-6 md:py-8">{children}</main>
    </div>
  );
}
