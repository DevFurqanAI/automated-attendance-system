import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { detectSpoofing } from '@/lib/attendance/detect';

const BRANCH = {
  id: 'branch-1',
  latitude: 51.5074,
  longitude: -0.1278,
  radius_meters: 100,
};

/** Right on top of the branch. */
const AT_BRANCH = { lat: 51.5074, lng: -0.1278 };

interface StubRows {
  /** Rows returned to the prior-event lookup and the jitter lookup. */
  prior?: Record<string, unknown>[];
  jitter?: Record<string, unknown>[];
}

/**
 * Minimal stand-in for the PostgREST query builder: every method returns the
 * same chainable object, which resolves to whichever fixture matches the
 * columns the caller selected.
 */
function stubSupabase(rows: StubRows): SupabaseClient {
  const from = () => {
    let selected = '';

    const builder: Record<string, unknown> = {
      select(columns: string) {
        selected = columns;
        return builder;
      },
      then(resolve: (value: { data: unknown }) => void) {
        // The jitter query is the one that asks for check_in_lat without the
        // check_out columns.
        const isJitter = !selected.includes('check_out_lat');
        resolve({ data: (isJitter ? rows.jitter : rows.prior) ?? [] });
      },
    };

    for (const method of ['eq', 'in', 'not', 'neq', 'order', 'limit']) {
      builder[method] = () => builder;
    }

    return builder;
  };

  return { from } as unknown as SupabaseClient;
}

const baseInput = {
  employeeId: 'emp-1',
  branch: BRANCH,
  accuracyMeters: 10,
  mockLocationReported: false,
};

describe('detectSpoofing — geofence', () => {
  it('approves a fix inside the geofence', async () => {
    const result = await detectSpoofing(stubSupabase({}), {
      ...baseInput,
      coords: AT_BRANCH,
    });

    expect(result.flagReason).toBeNull();
    expect(result.withinGeofence).toBe(true);
    expect(result.distanceMeters).toBeLessThan(1);
  });

  it('flags a fix well outside the geofence', async () => {
    const result = await detectSpoofing(stubSupabase({}), {
      ...baseInput,
      // ~1.1 km north of the branch.
      coords: { lat: 51.5174, lng: -0.1278 },
    });

    expect(result.flagReason).toBe('out_of_range');
    expect(result.withinGeofence).toBe(false);
  });

  it('widens the fence by the device accuracy, but only up to a cap', async () => {
    // ~130 m out: outside the 100 m fence, but a phone reporting ±50 m
    // uncertainty should be given the benefit of the doubt.
    const justOutside = { lat: 51.508568, lng: -0.1278 };

    const lenient = await detectSpoofing(stubSupabase({}), {
      ...baseInput,
      accuracyMeters: 50,
      coords: justOutside,
    });
    expect(lenient.flagReason).toBeNull();

    // A spoofer claiming absurd uncertainty gets no extra room — the slack is
    // capped at 50 m regardless of what the client says.
    const capped = await detectSpoofing(stubSupabase({}), {
      ...baseInput,
      accuracyMeters: 50_000,
      coords: { lat: 51.5174, lng: -0.1278 },
    });
    expect(capped.flagReason).toBe('out_of_range');
  });
});

describe('detectSpoofing — mock location', () => {
  it('flags a client-reported mock provider, ahead of every other check', async () => {
    const result = await detectSpoofing(stubSupabase({}), {
      ...baseInput,
      coords: AT_BRANCH,
      mockLocationReported: true,
    });

    expect(result.flagReason).toBe('mock_location_detected');
  });
});

describe('detectSpoofing — impossible travel', () => {
  it('flags a check-in that could not physically follow the previous one', async () => {
    const tenMinutesAgo = new Date(Date.now() - 10 * 60_000).toISOString();

    const result = await detectSpoofing(
      stubSupabase({
        prior: [
          {
            // New York, ten minutes ago.
            check_in_time: tenMinutesAgo,
            check_in_lat: 40.7128,
            check_in_lng: -74.006,
            check_out_time: null,
            check_out_lat: null,
            check_out_lng: null,
          },
        ],
      }),
      { ...baseInput, coords: AT_BRANCH },
    );

    expect(result.flagReason).toBe('impossible_travel');
    expect(result.detail).toMatch(/km\/h/);
  });

  it('allows a normal commute between branches', async () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 3_600_000).toISOString();

    const result = await detectSpoofing(
      stubSupabase({
        prior: [
          {
            // ~17 km away, two hours ago — an ordinary journey.
            check_in_time: twoHoursAgo,
            check_in_lat: 51.5074,
            check_in_lng: 0.1278,
            check_out_time: null,
            check_out_lat: null,
            check_out_lng: null,
          },
        ],
      }),
      { ...baseInput, coords: AT_BRANCH },
    );

    expect(result.flagReason).toBeNull();
  });

  it('ignores a prior event only seconds old (GPS noise, not travel)', async () => {
    const result = await detectSpoofing(
      stubSupabase({
        prior: [
          {
            check_in_time: new Date(Date.now() - 5_000).toISOString(),
            check_in_lat: 51.5074,
            check_in_lng: -0.1278,
            check_out_time: null,
            check_out_lat: null,
            check_out_lng: null,
          },
        ],
      }),
      { ...baseInput, coords: AT_BRANCH },
    );

    expect(result.flagReason).toBeNull();
  });
});

describe('detectSpoofing — coordinate jitter', () => {
  const dayAt = (daysAgo: number) =>
    new Date(Date.now() - daysAgo * 86_400_000).toISOString();

  it('flags coordinates replayed identically across many days', async () => {
    const jitter = [1, 2, 3, 4, 5, 6].map((d) => ({
      check_in_time: dayAt(d),
      check_in_lat: AT_BRANCH.lat,
      check_in_lng: AT_BRANCH.lng,
    }));

    const result = await detectSpoofing(stubSupabase({ jitter }), {
      ...baseInput,
      coords: AT_BRANCH,
    });

    expect(result.flagReason).toBe('coordinate_jitter');
  });

  it('accepts naturally varying coordinates', async () => {
    const jitter = [1, 2, 3, 4, 5, 6].map((d) => ({
      check_in_time: dayAt(d),
      // A few metres of drift each day, as real GPS produces.
      check_in_lat: AT_BRANCH.lat + d * 0.00005,
      check_in_lng: AT_BRANCH.lng + d * 0.00005,
    }));

    const result = await detectSpoofing(stubSupabase({ jitter }), {
      ...baseInput,
      coords: AT_BRANCH,
    });

    expect(result.flagReason).toBeNull();
  });

  it('does not flag a short run of identical readings', async () => {
    const jitter = [1, 2].map((d) => ({
      check_in_time: dayAt(d),
      check_in_lat: AT_BRANCH.lat,
      check_in_lng: AT_BRANCH.lng,
    }));

    const result = await detectSpoofing(stubSupabase({ jitter }), {
      ...baseInput,
      coords: AT_BRANCH,
    });

    expect(result.flagReason).toBeNull();
  });
});
