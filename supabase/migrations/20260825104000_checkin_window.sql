-- supabase/migrations/20260825104000_checkin_window.sql
-- =====================================================================
-- Branch check-in time windows.
-- =====================================================================
-- Optional per-branch "only open 08:00–20:00" restriction. Either bound
-- null (the default) means unrestricted. A check-in outside the window
-- lands as `flagged` with reason 'outside_checkin_window' — never blocked,
-- same reasoning as every other flag in this system (see the header
-- comment on src/lib/attendance/checkin-window.ts).
-- =====================================================================

alter table public.branches
  add column if not exists checkin_window_start time;
alter table public.branches
  add column if not exists checkin_window_end time;

create or replace view public.branches_public
  with (security_invoker = true) as
  select id, name, latitude, longitude, radius_meters, qr_version, created_at,
         weekly_off_days, expected_start_time, checkin_window_start, checkin_window_end
  from public.branches;

grant select (
  id, name, latitude, longitude, radius_meters, qr_version, created_at,
  weekly_off_days, expected_start_time, checkin_window_start, checkin_window_end
) on public.branches to authenticated;

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
      'remote_checkout_requested',
      'outside_checkin_window'
    )
  );
