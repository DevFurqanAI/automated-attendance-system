import { describe, expect, it } from 'vitest';
import {
  buildCalendarKindByDate,
  isOffDay,
  resolveOffDays,
} from '@/lib/attendance/workingDay';

describe('resolveOffDays', () => {
  it('prefers the employee override', () => {
    expect(resolveOffDays([1], [0])).toEqual([1]);
  });

  it('falls back to the branch default', () => {
    expect(resolveOffDays(null, [0, 1])).toEqual([0, 1]);
  });

  it('defaults to Sunday when neither is set', () => {
    expect(resolveOffDays(null, null)).toEqual([0]);
  });
});

describe('isOffDay', () => {
  // 2026-08-23 is a Sunday.
  it('treats a weekly off day as off', () => {
    expect(isOffDay('2026-08-23', [0], null)).toBe(true);
  });

  it('treats a working weekday as not off', () => {
    expect(isOffDay('2026-08-24', [0], null)).toBe(false);
  });

  it('a declared holiday is off regardless of weekday', () => {
    expect(isOffDay('2026-08-24', [0], 'holiday')).toBe(true);
  });

  it('a mandatory workday overrides a weekly off day', () => {
    expect(isOffDay('2026-08-23', [0], 'mandatory_workday')).toBe(false);
  });
});

describe('buildCalendarKindByDate', () => {
  it('applies the company-wide entry when there is no branch-specific one', () => {
    const map = buildCalendarKindByDate(
      [{ date: '2026-12-25', kind: 'holiday', branch_id: null }],
      'branch-1',
    );
    expect(map.get('2026-12-25')).toBe('holiday');
  });

  it('lets a branch-specific entry override the company-wide one for the same date', () => {
    const map = buildCalendarKindByDate(
      [
        { date: '2026-12-25', kind: 'holiday', branch_id: null },
        { date: '2026-12-25', kind: 'mandatory_workday', branch_id: 'branch-1' },
      ],
      'branch-1',
    );
    expect(map.get('2026-12-25')).toBe('mandatory_workday');
  });

  it('ignores another branch\'s entry', () => {
    const map = buildCalendarKindByDate(
      [{ date: '2026-12-25', kind: 'holiday', branch_id: 'branch-2' }],
      'branch-1',
    );
    expect(map.has('2026-12-25')).toBe(false);
  });
});
