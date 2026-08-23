import type { EmailOtpType } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/**
 * GET /auth/confirm — the landing point for every emailed auth link
 * (invitation, password recovery, email confirmation).
 *
 * Supabase's default `{{ .ConfirmationURL }}` bounces through its own verify
 * endpoint and returns the session in a URL *fragment* (`#access_token=...`).
 * Fragments are never sent to the server, so a server-rendered app like this
 * one cannot see them and the visitor lands back on the login page still
 * signed out — which is exactly the dead end this route fixes.
 *
 * Instead the email templates point here with a `token_hash`, which we exchange
 * for a real cookie session via verifyOtp. The mail templates are configured in
 * `scripts/configure-auth.mjs`.
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);

  const tokenHash = searchParams.get('token_hash');
  const type = searchParams.get('type') as EmailOtpType | null;
  const next = searchParams.get('next') ?? '/';

  // Only ever redirect to a path on this site — never to an absolute URL a
  // crafted link could smuggle in.
  const safeNext = next.startsWith('/') && !next.startsWith('//') ? next : '/';

  const fail = (reason: string) =>
    NextResponse.redirect(new URL(`/login?error=${reason}`, origin));

  if (!tokenHash || !type) return fail('link_incomplete');

  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });

  if (error) {
    // Most often the link was already used, or it expired (default 1 hour).
    return fail('link_invalid');
  }

  return NextResponse.redirect(new URL(safeNext, origin));
}
