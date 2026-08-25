-- supabase/migrations/20260825095000_withdrawn_status.sql
-- =====================================================================
-- 'withdrawn' status for leave_requests and attendance.
-- =====================================================================
-- An employee had no way to retract a pending leave or remote-check-in
-- request — a typo'd date, changed plans — short of asking HR to decline it,
-- which is semantically wrong: it shows up as "declined" (rejected) rather
-- than "withdrawn" (changed my mind) in both the employee's own history and
-- the audit trail, and sends them a "your request was declined" notification
-- for something they asked to cancel themselves.
--
-- See DELETE /api/attendance/leave and DELETE /api/attendance/remote —
-- employee-owned, pending-only, self-service.
-- =====================================================================

alter table public.leave_requests
  drop constraint if exists leave_requests_status_check;
alter table public.leave_requests
  add constraint leave_requests_status_check
  check (status in ('pending', 'approved', 'declined', 'withdrawn'));

alter table public.attendance
  drop constraint if exists attendance_status_check;
alter table public.attendance
  add constraint attendance_status_check
  check (status in ('approved', 'pending', 'flagged', 'declined', 'withdrawn'));
