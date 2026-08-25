import { describe, expect, it } from 'vitest';
import {
  LEAVE_MAX_SPAN_DAYS,
  daysInRangeWithinYear,
  totalLeaveDaysInYear,
  validateLeaveRange,
} from '@/lib/attendance/leave';

// 2026-08-24T10:00:00Z is 2026-08-24 15:00 in Asia/Karachi (UTC+5).
const NOW = new Date('2026-08-24T10:00:00.000Z');

describe('validateLeaveRange', () => {
  it('accepts today and future dates, in Asia/Karachi', () => {
    expect(validateLeaveRange('2026-08-24', '2026-08-25', NOW)).toEqual({
      ok: true,
      fromDate: '2026-08-24',
      toDate: '2026-08-25',
    });
  });

  it('rejects a from_date that has already passed', () => {
    const result = validateLeaveRange('2026-08-23', '2026-08-23', NOW);
    expect(result.ok).toBe(false);
  });

  it('rejects a to_date before from_date', () => {
    const result = validateLeaveRange('2026-08-25', '2026-08-24', NOW);
    expect(result.ok).toBe(false);
  });

  it('rejects a malformed date', () => {
    expect(validateLeaveRange('8/24/2026', '2026-08-24', NOW).ok).toBe(false);
    expect(validateLeaveRange('2026-08-24', 'not-a-date', NOW).ok).toBe(false);
  });

  it('accepts a single-day request', () => {
    expect(validateLeaveRange('2026-08-24', '2026-08-24', NOW).ok).toBe(true);
  });

  it(`accepts a request exactly ${LEAVE_MAX_SPAN_DAYS} days long`, () => {
    const to = new Date('2026-08-24T00:00:00Z');
    to.setUTCDate(to.getUTCDate() + LEAVE_MAX_SPAN_DAYS - 1);
    const toDate = to.toISOString().slice(0, 10);
    expect(validateLeaveRange('2026-08-24', toDate, NOW).ok).toBe(true);
  });

  it(`rejects a request longer than ${LEAVE_MAX_SPAN_DAYS} days`, () => {
    const to = new Date('2026-08-24T00:00:00Z');
    to.setUTCDate(to.getUTCDate() + LEAVE_MAX_SPAN_DAYS);
    const toDate = to.toISOString().slice(0, 10);
    const result = validateLeaveRange('2026-08-24', toDate, NOW);
    expect(result.ok).toBe(false);
  });
});

describe('daysInRangeWithinYear', () => {
  it('counts an ordinary same-year range inclusively', () => {
    expect(daysInRangeWithinYear('2026-03-01', '2026-03-05', 2026)).toBe(5);
  });

  it('counts a single day as 1', () => {
    expect(daysInRangeWithinYear('2026-03-01', '2026-03-01', 2026)).toBe(1);
  });

  it('clips a range that starts before the year', () => {
    expect(daysInRangeWithinYear('2025-12-29', '2026-01-03', 2026)).toBe(3);
  });

  it('clips a range that ends after the year', () => {
    expect(daysInRangeWithinYear('2026-12-29', '2027-01-03', 2026)).toBe(3);
  });

  it('returns 0 for a range entirely outside the year', () => {
    expect(daysInRangeWithinYear('2025-01-01', '2025-12-31', 2026)).toBe(0);
  });
});

describe('totalLeaveDaysInYear', () => {
  it('sums multiple approved ranges within the year', () => {
    const rows = [
      { from_date: '2026-01-05', to_date: '2026-01-09' },
      { from_date: '2026-06-01', to_date: '2026-06-01' },
    ];
    expect(totalLeaveDaysInYear(rows, 2026)).toBe(6);
  });

  it('returns 0 for no rows', () => {
    expect(totalLeaveDaysInYear([], 2026)).toBe(0);
  });
});
