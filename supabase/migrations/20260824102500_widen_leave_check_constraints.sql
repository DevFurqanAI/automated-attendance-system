-- supabase/migrations/20260824102500_audit_entity_type_leave.sql
-- audit_log.entity_type was constrained to ('attendance', 'employee',
-- 'branch') — leave.approve / leave.decline / absence.reversed audit entries
-- (entityType: 'leave_request') would otherwise fail this check.
alter table public.audit_log
  drop constraint if exists audit_log_entity_type_check;
alter table public.audit_log
  add constraint audit_log_entity_type_check
  check (entity_type in ('attendance', 'employee', 'branch', 'leave_request'));

-- Same gap on notifications.kind / notifications.entity_type: the leave_*
-- notification kinds and the 'leave_request' entity type introduced for the
-- leave workflow need the same widening.
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
    'account_deactivated'
  ));

alter table public.notifications
  drop constraint if exists notifications_entity_type_check;
alter table public.notifications
  add constraint notifications_entity_type_check
  check (entity_type in ('attendance', 'employee', 'branch', 'leave_request'));
