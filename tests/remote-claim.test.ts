import { describe, expect, it } from 'vitest';
import { validateRemoteCheckoutClaim, validateRemoteClaim } from '@/lib/attendance/remote-claim';

const NOW = new Date('2026-08-22T12:00:00Z');

const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000);

describe('validateRemoteClaim — the 2-day window (acceptance criterion)', () => {
  it('accepts a claim from earlier today', () => {
    const result = validateRemoteClaim(hoursAgo(4), null, NOW);
    expect(result.ok).toBe(true);
  });

  it('accepts a claim just inside the 2-day boundary', () => {
    // 47 hours back is comfortably within two days.
    const result = validateRemoteClaim(hoursAgo(47), null, NOW);
    expect(result.ok).toBe(true);
  });

  it('rejects a claim older than 2 days', () => {
    const result = validateRemoteClaim(hoursAgo(49), null, NOW);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/more than 2 days/i);
    }
  });

  it('rejects a claim far in the past', () => {
    const result = validateRemoteClaim(hoursAgo(24 * 30), null, NOW);
    expect(result.ok).toBe(false);
  });

  it('rejects a claim in the future', () => {
    const future = new Date(NOW.getTime() + 6 * 3_600_000);
    const result = validateRemoteClaim(future, null, NOW);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/future/i);
  });

  it('tolerates a few seconds of clock skew around "now"', () => {
    const slightlyAhead = new Date(NOW.getTime() + 30_000);
    expect(validateRemoteClaim(slightlyAhead, null, NOW).ok).toBe(true);
  });

  it('requires a check-in time', () => {
    expect(validateRemoteClaim(null, null, NOW).ok).toBe(false);
  });
});

describe('validateRemoteClaim — check-out ordering', () => {
  it('accepts a check-out after the check-in', () => {
    const result = validateRemoteClaim(hoursAgo(8), hoursAgo(1), NOW);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.checkOut).not.toBeNull();
  });

  it('rejects a check-out before the check-in', () => {
    const result = validateRemoteClaim(hoursAgo(1), hoursAgo(8), NOW);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/before/i);
  });

  it('rejects a check-out in the future', () => {
    const result = validateRemoteClaim(
      hoursAgo(2),
      new Date(NOW.getTime() + 3_600_000),
      NOW,
    );
    expect(result.ok).toBe(false);
  });

  it('allows an open-ended claim with no check-out', () => {
    const result = validateRemoteClaim(hoursAgo(3), null, NOW);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.checkOut).toBeNull();
  });
});

describe('validateRemoteCheckoutClaim — closing an already-open shift', () => {
  const checkIn = hoursAgo(6);

  it('defaults to now when no time is claimed', () => {
    const result = validateRemoteCheckoutClaim(checkIn, null, NOW);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.checkOut.getTime()).toBe(NOW.getTime());
  });

  it('accepts a claimed time after check-in', () => {
    const result = validateRemoteCheckoutClaim(checkIn, hoursAgo(2), NOW);
    expect(result.ok).toBe(true);
  });

  it('rejects a claimed time before check-in', () => {
    const result = validateRemoteCheckoutClaim(checkIn, hoursAgo(7), NOW);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/before/i);
  });

  it('rejects a claimed time in the future', () => {
    const future = new Date(NOW.getTime() + 3_600_000);
    const result = validateRemoteCheckoutClaim(checkIn, future, NOW);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/future/i);
  });

  it('tolerates a few seconds of clock skew around "now"', () => {
    const slightlyAhead = new Date(NOW.getTime() + 30_000);
    expect(validateRemoteCheckoutClaim(checkIn, slightlyAhead, NOW).ok).toBe(true);
  });

  it('has no age window — an old check-in is still fine', () => {
    const result = validateRemoteCheckoutClaim(hoursAgo(24 * 10), null, NOW);
    expect(result.ok).toBe(true);
  });
});
