'use client';

import { createBrowserClient } from '@supabase/ssr';
import { requirePublicEnv } from '@/lib/env';

/**
 * Browser Supabase client. Uses the publishable/anon key, so every query it
 * makes is subject to Row-Level Security.
 */
export function createClient() {
  const { supabaseUrl, supabaseKey } = requirePublicEnv();
  return createBrowserClient(supabaseUrl, supabaseKey);
}
