import { createServerClient } from '@supabase/ssr';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { cache } from 'react';
import { requirePublicEnv, requireServerEnv } from '@/lib/env';
import type { Employee } from '@/lib/types';

/**
 * Request-scoped Supabase client bound to the caller's session cookies.
 * Subject to RLS — use this for anything acting *as the user*.
 */
export async function createClient() {
  const cookieStore = await cookies();
  const { supabaseUrl, supabaseKey } = requirePublicEnv();

  return createServerClient(supabaseUrl, supabaseKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Called from a Server Component, where cookies are read-only.
          // The middleware refreshes the session, so this is safe to ignore.
        }
      },
    },
  });
}

/**
 * Service-role client. Bypasses RLS entirely.
 *
 * Only for work the user is not allowed to do directly: reading a branch's
 * `qr_secret`, and writing attendance rows whose status the server alone gets
 * to decide. Always establish who the caller is with `getSessionUser()` first.
 */
export function createAdminClient() {
  const { supabaseUrl, serviceRoleKey } = requireServerEnv();
  return createSupabaseClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export interface SessionUser {
  id: string;
  email: string;
  employee: Employee;
}

/**
 * Resolves the signed-in user and their employee record.
 *
 * Uses `getClaims()`, which verifies the JWT signature against the Auth
 * server rather than trusting whatever is in local storage.
 * Returns null when there is no valid session or the employee is deactivated.
 *
 * Wrapped in React's `cache()` so the layout and every page under it — each
 * of which calls this independently — share one JWT verification and one
 * `employees` round trip per request instead of paying for it again at every
 * level of the route tree. Safe to memoize per-request: nothing here reads
 * data that changes mid-request, and the cache never crosses requests.
 */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const supabase = await createClient();

  const { data, error } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (error || !claims?.sub) return null;

  // The employee row is the authority on role — never the JWT's user_metadata,
  // which the user can edit themselves.
  const { data: employee } = await supabase
    .from('employees')
    .select('*')
    .eq('id', claims.sub)
    .single<Employee>();

  if (!employee || !employee.active) return null;

  return {
    id: employee.id,
    email: employee.email,
    employee,
  };
});

/** Same as getSessionUser, but also asserts HR-level access (hr_admin or super_admin). */
export async function getHrUser(): Promise<SessionUser | null> {
  const user = await getSessionUser();
  if (!user || (user.employee.role !== 'hr_admin' && user.employee.role !== 'super_admin')) {
    return null;
  }
  return user;
}

/** Same as getSessionUser, but asserts the unscoped super_admin tier. */
export async function getSuperAdminUser(): Promise<SessionUser | null> {
  const user = await getSessionUser();
  if (!user || user.employee.role !== 'super_admin') return null;
  return user;
}
