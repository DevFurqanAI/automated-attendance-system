-- supabase/migrations/20260825097000_hr_mark_absent_leave.sql
-- =====================================================================
-- 'marked_absent' notification kind.
-- =====================================================================
-- HR can now mark an employee absent directly (POST /api/hr/absences)
-- without waiting for the nightly job, and record approved leave directly
-- (POST /api/hr/leave/mark) without the submit/approve round trip. The leave
-- path reuses the existing 'leave_approved' notification kind; the absence
-- path needed its own — see src/lib/notify.ts.
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
    'marked_absent'
  ));
