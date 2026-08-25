-- supabase/migrations/20260825094000_remote_checkout.sql
-- =====================================================================
-- Remote checkout for an open QR shift.
-- =====================================================================
-- An employee who checked in via QR+GPS, then left for a meeting and went
-- straight home, had no way to close that shift: check-out requires scanning
-- a branch's QR code, and claimed_check_out_time was restricted to
-- method = 'remote_request' rows only (see claims_only_on_remote below) — a
-- wholly separate record from the open qr_gps shift. Submitting a "remote
-- check-in" request did not touch the original shift at all, which stayed
-- open forever (the partial unique index in the init migration blocks any
-- further check-in while it does).
--
-- This lets a claimed check-out attach to the EXISTING qr_gps row instead:
-- POST /api/attendance/remote-checkout sets claimed_check_out_time and
-- remote_reason on the open shift and flags it for review. HR's
-- 'force_checkout' action (see 20260825093000_attendance_force_checkout.sql)
-- then closes it, pre-filled from the claim.
--
-- claimed_check_in_time stays remote_request-only — a qr_gps row's check-in
-- was already verified, so there is nothing to claim there.
-- =====================================================================

alter table public.attendance
  drop constraint if exists claims_only_on_remote;

alter table public.attendance
  add constraint claims_only_on_remote check (
    (method = 'remote_request' or claimed_check_in_time is null)
    and (method in ('remote_request', 'qr_gps') or claimed_check_out_time is null)
  );

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
      'force_closed',
      'remote_checkout_requested'
    )
  );
