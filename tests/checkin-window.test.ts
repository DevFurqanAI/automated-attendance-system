import { describe, expect, it } from 'vitest';
import { isWithinCheckinWindow } from '@/lib/attendance/checkin-window';

// 04:00Z is 09:00 in Asia/Karachi (UTC+5).
describe('isWithinCheckinWindow', () => {
  it('is always within when either bound is null', () => {
    expect(isWithinCheckinWindow('2026-08-24T04:00:00.000Z', null, '20:00')).toBe(true);
    expect(isWithinCheckinWindow('2026-08-24T04:00:00.000Z', '08:00', null)).toBe(true);
  });

  it('is within a normal same-day window', () => {
    expect(isWithinCheckinWindow('2026-08-24T04:00:00.000Z', '08:00', '20:00')).toBe(true);
  });

  it('is outside before the window opens', () => {
    // 06:00 local, window starts 08:00.
    expect(isWithinCheckinWindow('2026-08-24T01:00:00.000Z', '08:00', '20:00')).toBe(false);
  });

  it('is outside after the window closes', () => {
    // 21:00 local, window ends 20:00.
    expect(isWithinCheckinWindow('2026-08-24T16:00:00.000Z', '08:00', '20:00')).toBe(false);
  });

  it('handles an overnight window', () => {
    // 23:00 local — inside a 22:00–06:00 overnight window.
    expect(isWithinCheckinWindow('2026-08-24T18:00:00.000Z', '22:00', '06:00')).toBe(true);
    // 12:00 local — outside that same overnight window.
    expect(isWithinCheckinWindow('2026-08-24T07:00:00.000Z', '22:00', '06:00')).toBe(false);
  });
});
