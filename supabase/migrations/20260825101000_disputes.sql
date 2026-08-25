-- supabase/migrations/20260825101000_disputes.sql
-- =====================================================================
-- Attendance disputes — a formal "I think this is wrong" channel.
-- =====================================================================
-- Every other correction path in this system is HR-initiated (force
-- checkout, direct edit, mark present). An employee who notices a wrong
-- check-out time on their own history a week later, or disagrees with a
-- decline, had no channel but an informal message to HR.
--
-- Deliberately a SEPARATE queue from attendance.status: filing a dispute
-- does not change the underlying record (which may already be 'approved'
-- and stays that way while the dispute is open) — only HR's own edit
-- (PATCH /api/hr/attendance, see 20260825098000_hr_edit_attendance.sql)
-- changes the record itself. A dispute is a conversation about a record,
-- not a review state of it.
-- =====================================================================

create table if not exists public.disputes (
  id             uuid primary key default gen_random_uuid(),
  attendance_id  uuid not null references public.attendance(id) on delete cascade,
  employee_id    uuid not null references public.employees(id) on delete cascade,
  reason         text not null,
  status         text not null default 'open' check (status in ('open', 'resolved')),
  resolution_note text,
  resolved_by    uuid references public.employees(id) on delete set null,
  resolved_at    timestamptz,
  created_at     timestamptz not null default now()
);

create index if not exists disputes_status_idx on public.disputes (status, created_at desc);
create index if not exists disputes_employee_idx on public.disputes (employee_id, created_at desc);

alter table public.disputes enable row level security;
alter table public.disputes replica identity full;

drop policy if exists "disputes read own or hr" on public.disputes;
create policy "disputes read own or hr"
  on public.disputes for select
  to authenticated
  using (
    (select auth.uid()) = employee_id
    or private.is_super_admin()
    or (private.is_hr_admin() and employee_id in (select private.hr_visible_employee_ids()))
  );

-- Written only through the service role (same pattern as every other write
-- in this codebase — see the harden-grants migration): the employee-owned
-- POST and the HR-owned resolve both go through API routes with their own
-- application-level checks.
revoke all on public.disputes from anon, authenticated;
grant select on public.disputes to authenticated;

-- 'dispute_submitted' (to HR) / 'dispute_resolved' (to the employee).
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
    'attendance_corrected',
    'dispute_submitted',
    'dispute_resolved'
  ));
