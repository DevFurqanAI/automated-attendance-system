-- =====================================================================
-- audit_log — who did what to whom
-- =====================================================================
-- Before this, the only trace of any privileged action in the whole system was
-- `attendance.reviewed_by`. Role changes, deactivations, branch edits and QR
-- rotations left nothing at all: an HR admin could promote someone, be demoted
-- by them an hour later, and no record of either event would exist.
--
-- Append-only by construction: no API role holds INSERT (writes go through the
-- service role), and there is no UPDATE or DELETE policy at all, so even a
-- restored grant could not rewrite history through the Data API.
-- =====================================================================

create table if not exists public.audit_log (
  id          uuid primary key default gen_random_uuid(),

  actor_id    uuid references public.employees(id) on delete set null,
  -- Denormalised on purpose. An audit row has to stay readable after the
  -- employee it names is deleted, and `on delete set null` would otherwise
  -- leave an anonymous entry.
  actor_name  text not null,
  actor_email text not null,

  -- Dotted verb, e.g. 'attendance.approve', 'employee.role_change',
  -- 'branch.qr_rotate'. Kept as text rather than an enum so a new action does
  -- not need a migration to be recordable.
  action      text not null,

  entity_type text not null check (entity_type in ('attendance', 'employee', 'branch')),
  entity_id   uuid,

  -- Whose record this affected, when that differs from the entity (e.g. the
  -- employee behind an attendance row). Lets "everything done to Ali" be one
  -- query.
  subject_id  uuid references public.employees(id) on delete set null,

  -- True when actor and subject are the same person: self-approved attendance,
  -- and anything else where nobody independent was involved.
  self_action boolean not null default false,

  -- Free-form specifics: previous and new values, flag reasons, branch names.
  detail      jsonb not null default '{}'::jsonb,

  created_at  timestamptz not null default now()
);

comment on table public.audit_log is
  'Append-only record of privileged actions. Written exclusively by the '
  'service role from the API routes; readable by HR administrators.';

create index if not exists audit_log_created_idx
  on public.audit_log (created_at desc);
create index if not exists audit_log_subject_idx
  on public.audit_log (subject_id, created_at desc);
create index if not exists audit_log_entity_idx
  on public.audit_log (entity_type, entity_id, created_at desc);

alter table public.audit_log enable row level security;

-- Read-only, HR only. Deliberately no insert/update/delete policy: the service
-- role bypasses RLS, and nothing else may write here.
drop policy if exists "audit readable by hr" on public.audit_log;
create policy "audit readable by hr"
  on public.audit_log for select
  to authenticated
  using (private.is_hr_admin());

revoke insert, update, delete, truncate, references
  on public.audit_log from anon, authenticated;
