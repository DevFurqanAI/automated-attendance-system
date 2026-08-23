'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

/**
 * Rescues the session out of a URL fragment.
 *
 * Supabase's stock email templates link to `{{ .ConfirmationURL }}`, which
 * bounces through its verify endpoint and hands the session back as
 * `#access_token=…&refresh_token=…&type=invite`. A fragment is never sent to
 * the server, so the server-rendered app cannot see it: the visitor arrives
 * signed out and the proxy bounces them to /login.
 *
 * This page runs in the browser, where the fragment *is* readable, and writes
 * the session into the cookies the server reads. It exists because email
 * templates cannot be customised on Supabase's free tier — with custom SMTP,
 * `scripts/configure-auth.mjs` installs templates that point at /auth/confirm
 * instead, which does all of this server-side and never puts a token in a URL.
 */
export function CallbackClient() {
  const router = useRouter();
  const [failed, setFailed] = useState(false);
  // React runs effects twice in development. Exchanging the same code twice
  // fails the second time, so the work is guarded rather than merely idempotent.
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    // Read the fragment *before* creating the client: supabase-js clears it
    // when it detects a session in the URL, and that race is unwinnable.
    const hash = window.location.hash.replace(/^#/, '');
    const fragment = new URLSearchParams(hash);
    const query = new URLSearchParams(window.location.search);

    const accessToken = fragment.get('access_token');
    const refreshToken = fragment.get('refresh_token');
    const code = query.get('code');
    const type = fragment.get('type') ?? query.get('type');
    const errorDescription =
      fragment.get('error_description') ?? query.get('error_description');

    // Strip the tokens from the address bar before anything else can log them
    // — the Referer header on the next navigation would otherwise carry them.
    if (hash) {
      window.history.replaceState(null, '', window.location.pathname);
    }

    // An invitation is only the *first* sign-in; recovery is a password reset.
    // Both mean the visitor has no password they can use yet.
    const next =
      type === 'invite' || type === 'recovery' ? '/auth/set-password' : '/';

    async function run() {
      if (errorDescription) return setFailed(true);

      const supabase = createClient();

      if (accessToken && refreshToken) {
        const { error } = await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        });
        if (error) return setFailed(true);
      } else if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code);
        if (error) return setFailed(true);
      } else {
        // No credentials in the URL at all. If a session is already in the
        // cookies this is just a stray visit; otherwise the link is spent.
        const { data } = await supabase.auth.getSession();
        if (!data.session) return setFailed(true);
      }

      router.replace(next);
      router.refresh();
    }

    void run();
  }, [router]);

  useEffect(() => {
    if (failed) router.replace('/login?error=link_invalid');
  }, [failed, router]);

  return (
    <p role="status" className="text-center text-sm text-ink-muted">
      Signing you in…
    </p>
  );
}
