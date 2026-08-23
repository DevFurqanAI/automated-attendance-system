import { redirect } from 'next/navigation';
import { AppHeader } from '@/components/AppHeader';
import { createClient, getSessionUser } from '@/lib/supabase/server';

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

  // A head-only count: the bell needs the number, not the rows. RLS scopes it
  // to this user, so there is no recipient filter to get wrong.
  const supabase = await createClient();
  const { count } = await supabase
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .is('read_at', null);

  return (
    <div className="min-h-dvh">
      <AppHeader
        name={user.employee.full_name}
        role={user.employee.role}
        unreadCount={count ?? 0}
      />
      <main className="mx-auto max-w-6xl px-4 py-6 md:py-8">{children}</main>
    </div>
  );
}
