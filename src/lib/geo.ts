/** Geospatial helpers. Pure functions — no I/O, easy to unit test. */

const EARTH_RADIUS_M = 6_371_008.8;

const toRad = (deg: number) => (deg * Math.PI) / 180;

export interface Coords {
  lat: number;
  lng: number;
}

/**
 * Great-circle distance between two points, in metres (Haversine).
 *
 * Accurate to ~0.5% — far below the precision of consumer GPS, and more than
 * good enough for a 100 m geofence.
 */
export function haversineMeters(a: Coords, b: Coords): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;

  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Implied average speed between two timestamped points, in km/h. */
export function impliedSpeedKmh(
  from: Coords,
  fromTime: Date,
  to: Coords,
  toTime: Date,
): number {
  const meters = haversineMeters(from, to);
  const hours = Math.abs(toTime.getTime() - fromTime.getTime()) / 3_600_000;
  // Two events at the same instant in different places is infinitely fast.
  if (hours <= 0) return meters > 0 ? Number.POSITIVE_INFINITY : 0;
  return meters / 1000 / hours;
}

/** Rejects NaN, out-of-range, and the suspicious exact-zero island. */
export function isValidCoords(c: Partial<Coords>): c is Coords {
  return (
    typeof c.lat === 'number' &&
    typeof c.lng === 'number' &&
    Number.isFinite(c.lat) &&
    Number.isFinite(c.lng) &&
    Math.abs(c.lat) <= 90 &&
    Math.abs(c.lng) <= 180 &&
    !(c.lat === 0 && c.lng === 0)
  );
}

export function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}
