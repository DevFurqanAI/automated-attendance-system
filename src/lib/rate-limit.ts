import 'server-only';
import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Per-caller request throttling, counted in Postgres.
 *
 * See supabase/migrations/20260824094000_rate_limit.sql for why the counter is
 * in the database rather than in memory: this app runs on serverless functions
 * that do not share state.
 */

export interface RateLimitRule {
  /** Distinct name for the thing being limited, e.g. 'check-in'. */
  name: string;
  /** Requests permitted per window. */
  limit: number;
  windowSeconds: number;
}

/**
 * How generous each limit is, and why.
 *
 * These are set to stop scripted abuse without ever getting in a real
 * employee's way — someone standing at a branch door with a phone that will
 * not focus may legitimately retry a scan many times in a row.
 */
export const RATE_LIMITS = {
  /** A person checks in once or twice a day; the headroom is for retries. */
  checkIn: { name: 'check-in', limit: 20, windowSeconds: 300 },
  checkOut: { name: 'check-out', limit: 20, windowSeconds: 300 },
  /** Typed by hand, one at a time. Anything faster is not a person. */
  remote: { name: 'remote', limit: 10, windowSeconds: 3600 },
  /** Each invite sends an email, so this is also an anti-spam limit. */
  invite: { name: 'invite', limit: 30, windowSeconds: 3600 },
  /** Filed by hand, rarely; the headroom is for a family emergency needing
   *  a multi-day request plus a correction, not scripted abuse. */
  leave: { name: 'leave', limit: 10, windowSeconds: 3600 },
} as const satisfies Record<string, RateLimitRule>;

/**
 * Records a request against `rule` for `key` and says whether to proceed.
 *
 * FAILS OPEN. If the limiter itself is broken or unreachable, people can still
 * clock in — an attendance system that locks the workforce out because a
 * counter table is unavailable has failed much worse than one that briefly
 * stops throttling. The failure is logged so it is visible in Vercel.
 */
export async function checkRateLimit(
  admin: SupabaseClient,
  rule: RateLimitRule,
  key: string,
): Promise<boolean> {
  const { data, error } = await admin.rpc('rate_limit_hit', {
    p_bucket: `${rule.name}:${key}`,
    p_limit: rule.limit,
    p_window_seconds: rule.windowSeconds,
  });

  if (error) {
    console.error(`[rate-limit] ${rule.name} check failed open: ${error.message}`);
    return true;
  }
  return data !== false;
}

/**
 * The 429 to return when a limit trips. Phrased for the person holding the
 * phone, not the script that provoked it.
 */
export function tooManyRequests(rule: RateLimitRule): NextResponse {
  const minutes = Math.max(1, Math.round(rule.windowSeconds / 60));
  return NextResponse.json(
    {
      error:
        'Too many attempts. Please wait a few minutes and try again — if this ' +
        'keeps happening, contact your HR administrator.',
    },
    {
      status: 429,
      headers: { 'Retry-After': String(rule.windowSeconds), 'X-RateLimit-Window': `${minutes}m` },
    },
  );
}
