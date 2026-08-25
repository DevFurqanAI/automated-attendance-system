import { describe, expect, it } from 'vitest';
import { LATE_GRACE_MINUTES, lateMinutes, resolveExpectedStartTime } from '@/lib/attendance/lateness';

describe('resolveExpectedStartTime', () => {
  it('prefers the employee override', () => {
    expect(resolveExpectedStartTime('10:00', '09:00')).toBe('10:00');
  });

  it('falls back to the branch default', () => {
    expect(resolveExpectedStartTime(null, '09:00')).toBe('09:00');
  });

  it('returns null when neither is set', () => {
    expect(resolveExpectedStartTime(null, null)).toBeNull();
  });
});

describe('lateMinutes', () => {
  // 04:00Z is 09:00 in Asia/Karachi (UTC+5).
  it('returns null with no expected start time', () => {
    expect(lateMinutes('2026-08-24T04:00:00.000Z', null)).toBeNull();
  });

  it('returns null for an on-time arrival', () => {
    expect(lateMinutes('2026-08-24T04:00:00.000Z', '09:00')).toBeNull();
  });

  it('returns null within the grace window', () => {
    // 09:10 local, 10 minutes after a 09:00 expectation — inside the default grace.
    expect(lateMinutes('2026-08-24T04:10:00.000Z', '09:00')).toBeNull();
    expect(LATE_GRACE_MINUTES).toBeGreaterThanOrEqual(10);
  });

  it('returns minutes late beyond the grace window', () => {
    // 09:30 local, 30 minutes after a 09:00 expectation.
    expect(lateMinutes('2026-08-24T04:30:00.000Z', '09:00')).toBe(30 - LATE_GRACE_MINUTES);
  });

  it('returns null for an early arrival', () => {
    // 08:45 local, before the 09:00 expectation.
    expect(lateMinutes('2026-08-24T03:45:00.000Z', '09:00')).toBeNull();
  });
});
