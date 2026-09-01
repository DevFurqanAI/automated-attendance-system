/**
 * Validated categorical triple (first three slots of the dataviz skill's
 * reference palette — the only three that clear ALL adjacent-pair CVD/
 * normal-vision floors, not just neighbor-to-neighbor) — see
 * references/palette.md in the dataviz skill. Fixed order, never cycled;
 * status colors (approved/declined/flagged) are deliberately NOT reused
 * here — a status color never doubles as a series (see the skill's
 * non-negotiables). Shared by the analytics daily-trend chart and the
 * calendar views so "present/absent/leave" always means the same color.
 */
export const ATTENDANCE_SERIES = {
  present: '#2a78d6', // slot 1, blue
  absent: '#eb6834', // slot 2, orange
  leave: '#1baf7a', // slot 3, aqua
} as const;
