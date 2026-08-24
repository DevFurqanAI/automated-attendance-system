import { describe, expect, it } from 'vitest';
import { validateLeaveRange } from '@/lib/attendance/leave';

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
});
