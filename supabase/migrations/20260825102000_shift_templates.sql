-- supabase/migrations/20260825102000_shift_templates.sql
-- =====================================================================
-- Expected shift start time — the minimal "shift template": one field,
-- not a full scheduling system.
-- =====================================================================
-- Same precedence shape as weekly_off_days (20260824101000, 20260825092000):
-- an employee's own expected_start_time overrides their branch's; either can
-- be null, meaning no expectation is set and lateness is simply never
-- computed for that person. See resolveExpectedStartTime() /
-- isLateArrival() in src/lib/attendance/lateness.ts.
--
-- Informational only, like leave balance — see that migration's comment.
-- A late arrival is shown, not flagged into the review queue: it isn't a
-- fraud signal (see detectSpoofing), and this app's flag/review machinery
-- is reserved for that.
-- =====================================================================

alter table public.branches
  add column if not exists expected_start_time time;
alter table public.employees
  add column if not exists expected_start_time time;

-- branches_public gains the new column — append-only, same reasoning as
-- 20260824101000_schedule_holidays.sql's own addition of weekly_off_days.
create or replace view public.branches_public
  with (security_invoker = true) as
  select id, name, latitude, longitude, radius_meters, qr_version, created_at,
         weekly_off_days, expected_start_time
  from public.branches;

grant select (
  id, name, latitude, longitude, radius_meters, qr_version, created_at,
  weekly_off_days, expected_start_time
) on public.branches to authenticated;
