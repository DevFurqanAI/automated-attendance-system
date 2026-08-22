'use client';

/**
 * Location capture for check-in, with the browser-observable half of the
 * mock-location check (spec §7.3).
 *
 * ── IMPORTANT PLATFORM LIMITATION ──────────────────────────────────────────
 * The spec assumes the client can read an OS mock-location flag ("Android/iOS
 * expose signals when a fake-GPS app is active"). That is true for *native*
 * apps — Android exposes `Location.isMock()` / `isFromMockProvider()`. It is
 * NOT exposed to web pages: the W3C Geolocation API deliberately reports no
 * provider metadata, and a PWA has no way to reach the native call.
 *
 * So this module reports what a browser genuinely can observe, and the server
 * treats the result as one signal among several rather than the whole answer:
 *
 *   1. Impossible accuracy — fake-GPS apps commonly report accuracy of exactly
 *      0, or a GPS-grade figure a real fix never sustains.
 *   2. Zero jitter — a real GNSS fix wanders metre-to-metre between reads.
 *      Several consecutive byte-identical fixes means a fixed injected value.
 *
 * The compensating controls live server-side, where they cannot be patched out
 * by a modified client: the geofence, the impossible-travel check, and the
 * cross-day coordinate-jitter check in lib/attendance/detect.ts.
 *
 * If OS-level certainty is later required, the path is a thin native wrapper
 * (Capacitor/TWA) that posts the real `isMock` flag to the same API field.
 * ───────────────────────────────────────────────────────────────────────────
 */

export interface LocationFix {
  lat: number;
  lng: number;
  accuracy: number | null;
  /** Best-effort spoofing signal — see the caveat above. */
  mockLocation: boolean;
  /** Why `mockLocation` is true, for the on-screen explanation. */
  mockReason: string | null;
}

export class LocationError extends Error {
  constructor(
    message: string,
    readonly code: 'denied' | 'unavailable' | 'timeout' | 'unsupported',
  ) {
    super(message);
    this.name = 'LocationError';
  }
}

/** How many fixes to collect before deciding. */
const SAMPLE_TARGET = 4;
const SAMPLE_WINDOW_MS = 4000;
const OVERALL_TIMEOUT_MS = 20000;

/**
 * A real GNSS fix never reports better than this in the wild. Anything at or
 * below it, sustained, is synthetic.
 */
const IMPLAUSIBLE_ACCURACY_M = 1;

/**
 * Only treat "no jitter" as suspicious when the reported accuracy claims
 * GPS-grade precision. Wi-Fi/IP positioning legitimately returns the exact
 * same coordinate every time, but always with a coarse accuracy figure.
 */
const JITTER_CHECK_ACCURACY_CEILING_M = 20;

export async function captureLocation(): Promise<LocationFix> {
  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    throw new LocationError(
      'This device or browser does not support location access.',
      'unsupported',
    );
  }

  const samples = await collectSamples();
  const latest = samples[samples.length - 1];

  const accuracy = Number.isFinite(latest.coords.accuracy)
    ? latest.coords.accuracy
    : null;

  let mockLocation = false;
  let mockReason: string | null = null;

  if (accuracy != null && accuracy <= IMPLAUSIBLE_ACCURACY_M) {
    mockLocation = true;
    mockReason = `Reported accuracy of ${accuracy} m is not physically achievable.`;
  } else if (
    samples.length >= 3 &&
    accuracy != null &&
    accuracy <= JITTER_CHECK_ACCURACY_CEILING_M &&
    allIdentical(samples)
  ) {
    mockLocation = true;
    mockReason =
      `${samples.length} consecutive fixes were byte-identical; a real GPS ` +
      `signal varies between readings.`;
  }

  return {
    lat: latest.coords.latitude,
    lng: latest.coords.longitude,
    accuracy,
    mockLocation,
    mockReason,
  };
}

function allIdentical(samples: GeolocationPosition[]): boolean {
  const first = samples[0].coords;
  return samples.every(
    (s) =>
      s.coords.latitude === first.latitude &&
      s.coords.longitude === first.longitude,
  );
}

/**
 * Collects several fresh fixes via watchPosition. `maximumAge: 0` is essential
 * — a cached position would look artificially stable and trip the jitter check.
 */
function collectSamples(): Promise<GeolocationPosition[]> {
  return new Promise((resolve, reject) => {
    const samples: GeolocationPosition[] = [];
    let watchId: number | null = null;
    let settled = false;

    const cleanup = () => {
      if (watchId !== null) navigator.geolocation.clearWatch(watchId);
      clearTimeout(windowTimer);
      clearTimeout(hardTimer);
    };

    const finish = () => {
      if (settled) return;
      settled = true;
      cleanup();
      if (samples.length === 0) {
        reject(
          new LocationError(
            'Could not get a location fix. Move somewhere with a clearer view of the sky and try again.',
            'unavailable',
          ),
        );
      } else {
        resolve(samples);
      }
    };

    const fail = (err: LocationError) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(err);
    };

    // Stop as soon as the sampling window closes, even if we have fewer than
    // SAMPLE_TARGET fixes — a slow fix should not block the whole check-in.
    const windowTimer = setTimeout(finish, SAMPLE_WINDOW_MS);
    const hardTimer = setTimeout(
      () =>
        samples.length > 0
          ? finish()
          : fail(
              new LocationError(
                'Timed out waiting for your location. Try again outdoors or near a window.',
                'timeout',
              ),
            ),
      OVERALL_TIMEOUT_MS,
    );

    watchId = navigator.geolocation.watchPosition(
      (position) => {
        samples.push(position);
        if (samples.length >= SAMPLE_TARGET) finish();
      },
      (error) => {
        if (error.code === error.PERMISSION_DENIED) {
          fail(
            new LocationError(
              'Location permission was denied. Check-in needs your location to confirm you are at the branch.',
              'denied',
            ),
          );
          return;
        }
        // Position-unavailable can fire transiently while the GPS warms up;
        // only give up if nothing has arrived at all.
        if (samples.length === 0 && error.code === error.TIMEOUT) {
          fail(new LocationError('Timed out waiting for your location.', 'timeout'));
        }
      },
      {
        enableHighAccuracy: true,
        maximumAge: 0,
        timeout: OVERALL_TIMEOUT_MS,
      },
    );
  });
}
