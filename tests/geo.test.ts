import { describe, expect, it } from 'vitest';
import { haversineMeters, impliedSpeedKmh, isValidCoords } from '@/lib/geo';

describe('haversineMeters', () => {
  it('returns zero for the same point', () => {
    expect(haversineMeters({ lat: 51.5, lng: -0.12 }, { lat: 51.5, lng: -0.12 })).toBe(0);
  });

  it('matches a known distance (London ↔ Paris ≈ 344 km)', () => {
    const meters = haversineMeters(
      { lat: 51.5074, lng: -0.1278 },
      { lat: 48.8566, lng: 2.3522 },
    );
    expect(meters / 1000).toBeGreaterThan(340);
    expect(meters / 1000).toBeLessThan(348);
  });

  it('resolves geofence-scale distances accurately', () => {
    // 0.001° of latitude is ~111 m anywhere on Earth.
    const meters = haversineMeters({ lat: 10, lng: 20 }, { lat: 10.001, lng: 20 });
    expect(meters).toBeGreaterThan(110);
    expect(meters).toBeLessThan(112);
  });

  it('is symmetric', () => {
    const a = { lat: 1.23, lng: 4.56 };
    const b = { lat: 7.89, lng: 0.12 };
    expect(haversineMeters(a, b)).toBeCloseTo(haversineMeters(b, a), 6);
  });
});

describe('impliedSpeedKmh', () => {
  it('computes a plausible commute speed', () => {
    const from = { lat: 51.5074, lng: -0.1278 };
    const to = { lat: 51.5074, lng: 0.1278 };
    const t0 = new Date('2026-08-22T09:00:00Z');
    const t1 = new Date('2026-08-22T10:00:00Z');

    const speed = impliedSpeedKmh(from, t0, to, t1);
    // ~17.7 km covered in one hour.
    expect(speed).toBeGreaterThan(15);
    expect(speed).toBeLessThan(20);
  });

  it('treats two places at the same instant as infinitely fast', () => {
    const t = new Date('2026-08-22T09:00:00Z');
    const speed = impliedSpeedKmh({ lat: 0, lng: 0.5 }, t, { lat: 10, lng: 10 }, t);
    expect(speed).toBe(Number.POSITIVE_INFINITY);
  });

  it('flags a cross-continent hop in minutes as implausible', () => {
    const speed = impliedSpeedKmh(
      { lat: 51.5074, lng: -0.1278 },
      new Date('2026-08-22T09:00:00Z'),
      { lat: 40.7128, lng: -74.006 },
      new Date('2026-08-22T09:10:00Z'),
    );
    expect(speed).toBeGreaterThan(250);
  });
});

describe('isValidCoords', () => {
  it.each([
    ['valid', { lat: 51.5, lng: -0.12 }, true],
    ['null island', { lat: 0, lng: 0 }, false],
    ['latitude out of range', { lat: 91, lng: 0 }, false],
    ['longitude out of range', { lat: 0, lng: 181 }, false],
    ['NaN', { lat: Number.NaN, lng: 0 }, false],
    ['missing', {}, false],
  ])('%s', (_label, input, expected) => {
    expect(isValidCoords(input)).toBe(expected);
  });
});
