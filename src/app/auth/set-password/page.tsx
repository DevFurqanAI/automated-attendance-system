import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { AuthShell } from '../AuthShell';
import { SetPasswordForm } from './SetPasswordForm';

export const metadata: Metadata = { title: 'Choose a password' };

/**
 * Where an invitation or a password-reset link ends up.
 *
 * /auth/confirm has already exchanged the emailed token for a session by the
 * time this renders, so the visitor is signed in — they just have no password
 * of their own yet. Without a session there is nothing to update, which means
 * the link was reused, expired, or typed by hand.
 *
 * This route is public in `src/proxy.ts` (the whole `/auth` prefix is), so the
 * session check has to happen here.
 */
export default async function SetPasswordPage() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();

  if (!data?.claims?.sub) redirect('/login?error=link_invalid');

  return (
    <AuthShell
      title="Choose a password"
      subtitle="You are signed in. Set a password so you can sign in again later."
      footer="This link works once. Finish here — leaving without setting a password means asking HR for another invitation."
    >
      <SetPasswordForm />
    </AuthShell>
  );
}
