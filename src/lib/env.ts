/**
 * Environment access with fail-fast validation.
 *
 * Server-only secrets are read lazily so that importing this module from a
 * client component never throws (and never bundles the secret).
 */

function required(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(
      `Missing required environment variable ${name}. ` +
        `Copy .env.example to .env.local and fill it in.`,
    );
  }
  return value;
}

/** Safe to expose to the browser. */
export const publicEnv = {
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
  /**
   * Supabase now calls this the "publishable" key; older projects call it the
   * "anon" key. Either works — we accept both names so the project can be
   * pointed at a legacy or a current Supabase project without code changes.
   */
  supabaseKey:
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
};

export function requirePublicEnv() {
  return {
    supabaseUrl: required('NEXT_PUBLIC_SUPABASE_URL', publicEnv.supabaseUrl),
    supabaseKey: required(
      'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
      publicEnv.supabaseKey,
    ),
  };
}

/**
 * Server-only. Throws if called from a client bundle.
 * The service role key bypasses RLS entirely — it must never reach the browser.
 */
export function requireServerEnv() {
  if (typeof window !== 'undefined') {
    throw new Error('requireServerEnv() must never be called in the browser.');
  }
  return {
    ...requirePublicEnv(),
    serviceRoleKey: required(
      'SUPABASE_SERVICE_ROLE_KEY',
      process.env.SUPABASE_SERVICE_ROLE_KEY,
    ),
  };
}
