-- supabase/migrations/20260825096000_hr_manual_attendance.sql
-- =====================================================================
-- 'hr_manual' attendance method — HR marking an employee present directly.
-- =====================================================================
-- Every other path onto the attendance table is employee-initiated (a scan,
-- a claim) with HR only ever approving/declining/correcting what was
-- submitted. There was no way for HR to create a record outright — e.g.
-- an employee whose phone had no signal all day, a paper sign-in sheet from
-- before this system existed, or a correction where nothing was ever
-- submitted at all.
--
-- POST /api/hr/attendance creates a `hr_manual` row that lands directly as
-- 'approved' — HR creating the record already IS the authorization; there is
-- no one else to review it. Always audited ('attendance.hr_create').
-- =====================================================================

alter table public.attendance
  drop constraint if exists attendance_method_check;
alter table public.attendance
  add constraint attendance_method_check
  check (method in ('qr_gps', 'remote_request', 'hr_manual'));

-- 'email_changed' — HR correcting or updating an employee's sign-in address
-- (see PATCH /api/hr/employees).
alter table public.notifications
  drop constraint if exists notifications_kind_check;
alter table public.notifications
  add constraint notifications_kind_check
  check (kind in (
    'attendance_approved',
    'attendance_declined',
    'attendance_flagged',
    'remote_submitted',
    'leave_submitted',
    'leave_approved',
    'leave_declined',
    'review_needed',
    'role_changed',
    'account_deactivated',
    'email_changed'
  ));
