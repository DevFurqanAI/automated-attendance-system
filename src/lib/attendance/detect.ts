import type { SupabaseClient } from '@supabase/supabase-js';
import { haversineMeters, impliedSpeedKmh, type Coords } from '@/lib/geo';
import type { FlagReason } from '@/lib/types';

/**
 * Server-side spoofing detection (spec §7.3).
 *
 * Every check runs against data the *server* holds. The single client-supplied
 * input (`mockLocationReported`) can only ever make the result stricter, never
 * more permissive — a client that lies and says "no mock location" still has to
 * pass the geofence, travel, and jitter checks.
 */

/** Fastest plausible ground/air travel between two branches, km/h. */
const MAX_PLAUSIBLE_SPEED_KMH = 250;

/** Ignore the travel check below this gap — GPS noise dominates. */
const MIN_TRAVEL_GAP_SECONDS = 60;

/** How many recent check-ins the jitter check looks at. */
const JITTER_WINDOW = 8;

/**
 * Consecutive readings closer together than this are treated as "identical".
 * Real consumer GPS drifts several metres between readings even when the phone
 * is sitting still, so sub-metre agreement across many days is a replayed
 * coordinate, not a person.
 */
const JITTER_IDENTICAL_METERS = 1;

/** Minimum number of near-identical readings before flagging. */
const JITTER_MIN_REPEATS = 5;

export interface DetectionInput {
  employeeId: string;
  coords: Coords;
  branch: { id: string; latitude: number; longitude: number; radius_meters: number };
  accuracyMeters: number | null;
  mockLocationReported: boolean;
  /** Excluded from the history lookups (used on check-out). */
  excludeAttendanceId?: string;
}

export interface DetectionResult {
  distanceMeters: number;
  withinGeofence: boolean;
  flagReason: FlagReason | null;
  /** Human-readable detail for the HR dashboard. */
  detail: string | null;
}

interface PriorEvent {
  coords: Coords;
  at: Date;
}

/**
 * Runs all four checks and returns the FIRST reason that trips, in severity
 * order: an outright fake location outranks a geofence miss, which outranks
 * the statistical checks.
 */
export async function detectSpoofing(
  supabase: SupabaseClient,
  input: DetectionInput,
): Promise<DetectionResult> {
  const { coords, branch } = input;

  const distanceMeters = haversineMeters(coords, {
    lat: Number(branch.latitude),
    lng: Number(branch.longitude),
  });

  // A phone reporting 500 m of uncertainty can sit "inside" a 100 m fence by
  // luck, so the fence is widened by the device's own stated accuracy — but
  // only up to a cap, so a spoofer cannot claim 50 km of accuracy to get in.
  const accuracySlack = Math.min(Math.max(input.accuracyMeters ?? 0, 0), 50);
  const withinGeofence = distanceMeters <= branch.radius_meters + accuracySlack;

  // 1. Mock location — client-reported, trusted only in the "guilty" direction.
  if (input.mockLocationReported) {
    return {
      distanceMeters,
      withinGeofence,
      flagReason: 'mock_location_detected',
      detail: 'Device reported an active mock-location provider.',
    };
  }

  // 2. Geofence.
  if (!withinGeofence) {
    return {
      distanceMeters,
      withinGeofence,
      flagReason: 'out_of_range',
      detail:
        `Reported position is ${Math.round(distanceMeters)} m from the branch, ` +
        `outside its ${branch.radius_meters} m geofence.`,
    };
  }

  // 3. Impossible travel, against the employee's immediately prior event.
  const prior = await loadPriorEvent(supabase, input);
  if (prior) {
    const gapSeconds = Math.abs(Date.now() - prior.at.getTime()) / 1000;
    if (gapSeconds >= MIN_TRAVEL_GAP_SECONDS) {
      const speed = impliedSpeedKmh(prior.coords, prior.at, coords, new Date());
      if (speed > MAX_PLAUSIBLE_SPEED_KMH) {
        const km = haversineMeters(prior.coords, coords) / 1000;
        return {
          distanceMeters,
          withinGeofence,
          flagReason: 'impossible_travel',
          detail:
            `${km.toFixed(1)} km from the previous recorded position in ` +
            `${formatGap(gapSeconds)} (~${Math.round(speed)} km/h).`,
        };
      }
    }
  }

  // 4. Coordinate jitter — the same fixed point replayed day after day.
  const jitter = await detectJitter(supabase, input);
  if (jitter) {
    return { distanceMeters, withinGeofence, flagReason: 'coordinate_jitter', detail: jitter };
  }

  return { distanceMeters, withinGeofence, flagReason: null, detail: null };
}

/** The employee's most recent positioned event (check-out beats check-in). */
async function loadPriorEvent(
  supabase: SupabaseClient,
  input: DetectionInput,
): Promise<PriorEvent | null> {
  let query = supabase
    .from('attendance')
    .select(
      'check_in_time, check_out_time, check_in_lat, check_in_lng, check_out_lat, check_out_lng',
    )
    .eq('employee_id', input.employeeId)
    .eq('method', 'qr_gps')
    .in('status', ['approved', 'flagged'])
    .order('check_in_time', { ascending: false, nullsFirst: false })
    .limit(1);

  if (input.excludeAttendanceId) {
    query = query.neq('id', input.excludeAttendanceId);
  }

  const { data } = await query;
  const row = data?.[0];
  if (!row) return null;

  // Prefer the check-out (it is the later of the two) when present.
  if (row.check_out_time && row.check_out_lat != null && row.check_out_lng != null) {
    return {
      coords: { lat: Number(row.check_out_lat), lng: Number(row.check_out_lng) },
      at: new Date(row.check_out_time),
    };
  }
  if (row.check_in_time && row.check_in_lat != null && row.check_in_lng != null) {
    return {
      coords: { lat: Number(row.check_in_lat), lng: Number(row.check_in_lng) },
      at: new Date(row.check_in_time),
    };
  }
  return null;
}

/**
 * Flags an employee whose recent check-ins land on a pixel-perfect identical
 * coordinate. Only counts one reading per calendar day, so a legitimate
 * same-day re-scan cannot trip it.
 */
async function detectJitter(
  supabase: SupabaseClient,
  input: DetectionInput,
): Promise<string | null> {
  let query = supabase
    .from('attendance')
    .select('check_in_time, check_in_lat, check_in_lng')
    .eq('employee_id', input.employeeId)
    .eq('method', 'qr_gps')
    .in('status', ['approved', 'flagged'])
    .not('check_in_lat', 'is', null)
    .order('check_in_time', { ascending: false, nullsFirst: false })
    .limit(JITTER_WINDOW * 3);

  if (input.excludeAttendanceId) {
    query = query.neq('id', input.excludeAttendanceId);
  }

  const { data } = await query;
  if (!data?.length) return null;

  // Collapse to one reading per day, most recent first.
  const seenDays = new Set<string>();
  const daily: Coords[] = [];
  for (const row of data) {
    if (!row.check_in_time) continue;
    const day = row.check_in_time.slice(0, 10);
    if (seenDays.has(day)) continue;
    seenDays.add(day);
    daily.push({ lat: Number(row.check_in_lat), lng: Number(row.check_in_lng) });
    if (daily.length >= JITTER_WINDOW) break;
  }

  // Count how many consecutive prior days match today's reading exactly.
  let repeats = 0;
  for (const prior of daily) {
    if (haversineMeters(input.coords, prior) <= JITTER_IDENTICAL_METERS) {
      repeats += 1;
    } else {
      break;
    }
  }

  if (repeats >= JITTER_MIN_REPEATS) {
    return (
      `Reported coordinates are identical (within ${JITTER_IDENTICAL_METERS} m) ` +
      `to the last ${repeats} days of check-ins. Real GPS varies between readings.`
    );
  }
  return null;
}

function formatGap(seconds: number): string {
  if (seconds < 3600) return `${Math.round(seconds / 60)} min`;
  return `${(seconds / 3600).toFixed(1)} h`;
}
