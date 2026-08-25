-- supabase/migrations/20260825098000_hr_edit_attendance.sql
-- =====================================================================
-- 'attendance_corrected' notification kind.
-- =====================================================================
-- PATCH /api/hr/attendance lets HR correct an attendance record, including
-- an already-settled one — the review queue deliberately refuses to touch
-- those (see the guard in src/app/api/hr/review/route.ts), so this is the
-- escape hatch when a correction is genuinely needed. Requires a reason,
-- and every change lands as an explicit before/after pair in the audit log
-- (action 'attendance.hr_edit'), never a silent overwrite.
-- =====================================================================

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
    'email_changed',
    'marked_absent',
    'attendance_corrected'
  ));
