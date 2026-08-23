import type { Metadata } from 'next';
import { AuthShell } from '../AuthShell';
import { CallbackClient } from './CallbackClient';

export const metadata: Metadata = { title: 'Signing you in' };

/**
 * Landing point for Supabase's stock email links — see CallbackClient for why
 * this has to happen in the browser rather than on the server.
 *
 * `scripts/configure-auth.mjs` points `site_url` here when it cannot install
 * custom email templates.
 */
export default function CallbackPage() {
  return (
    <AuthShell
      title="Just a moment"
      subtitle="Finishing your sign-in."
      footer="If nothing happens, open the link from your email again."
    >
      <CallbackClient />
    </AuthShell>
  );
}
