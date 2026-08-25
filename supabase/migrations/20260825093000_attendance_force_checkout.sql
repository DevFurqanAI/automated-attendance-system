-- supabase/migrations/20260825093000_attendance_force_checkout.sql
-- =====================================================================
-- HR force-checkout for a stuck open shift.
-- =====================================================================
-- A qr_gps shift with no check_out_time cannot be reviewed at all — see the
-- guard in src/app/api/hr/review/route.ts — and the employee cannot check in
-- again anywhere else until they check out (the partial unique index in the
-- init migration). A lost phone, a crashed app, or simply forgetting leaves
-- the shift stuck with no recovery path except direct database access.
--
-- `force_closed` lets HR supply the missing check-out time themselves. It is
-- always a flag, never a silent approval: the time was not scanned or
-- geofence-verified, so a human still has to decide what the shift was worth
-- via the normal approve/decline path afterward — see 'attendance.force_checkout'
-- in src/lib/audit.ts.
-- =====================================================================

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
      'branch_mismatch',
      'force_closed'
    )
  );
