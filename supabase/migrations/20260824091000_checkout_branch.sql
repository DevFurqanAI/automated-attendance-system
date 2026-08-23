-- =====================================================================
-- Record where a shift was CLOSED, not just where it was opened
-- =====================================================================
-- Check-out verified the scanned QR token and the geofence around whatever
-- branch that token named — but never compared it against the branch the shift
-- was opened at. Scanning in at one branch and out at another therefore
-- recorded a clean, approved shift attributed entirely to the first branch:
-- both scans were legitimately inside their own geofences, so no existing
-- check could object.
--
-- Impossible-travel does not catch it either. That check needs >250 km/h; the
-- Multan branches are a few km apart across a shift lasting hours.
--
-- Two changes:
--   * `check_out_branch_id` — so HR can see both ends of a shift instead of
--     inferring one from the other.
--   * `branch_mismatch` — a new flag reason, so a split shift lands in the
--     review queue rather than counting silently.
--
-- Deliberately a flag and not a rejection: the person did work, and this
-- system's rule throughout is that attendance is recorded and queued for a
-- human, never silently dropped.
-- =====================================================================

alter table public.attendance
  add column if not exists check_out_branch_id uuid
    references public.branches(id) on delete set null;

comment on column public.attendance.check_out_branch_id is
  'Branch whose QR code closed the shift. Equal to branch_id for an ordinary '
  'shift; different when the employee checked out elsewhere, which also raises '
  'the branch_mismatch flag. NULL while the shift is open.';

-- Extend the flag vocabulary. Postgres names a column-level CHECK
-- `<table>_<column>_check`, so this replaces the constraint from the initial
-- migration rather than adding a second one.
alter table public.attendance
  drop constraint if exists attendance_flag_reason_check;

alter table public.attendance
  add constraint attendance_flag_reason_check check (
    flag_reason is null
    or flag_reason in (
      'mock_location_detected',
      'impossible_travel',
      'coordinate_jitter',
      'out_of_range',
      'branch_mismatch'
    )
  );
