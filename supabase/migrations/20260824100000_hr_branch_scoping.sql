-- supabase/migrations/20260824100000_hr_branch_scoping.sql
-- =====================================================================
-- Super-admin tier + per-branch HR scoping.
--
-- HR admins are no longer global: an hr_admin only sees employees whose
-- default_branch_id is one of their assigned branches (or who have no
-- branch at all). super_admin bypasses scoping entirely. See
-- docs/superpowers/specs/2026-08-24-absence-leave-hr-scoping-design.md.
-- =====================================================================

alter table public.employees
  drop constraint if exists employees_role_check;
alter table public.employees
  add constraint employees_role_check
  check (role in ('employee', 'hr_admin', 'super_admin'));

create table if not exists public.hr_branch_assignments (
  hr_admin_id uuid not null references public.employees(id) on delete cascade,
  branch_id   uuid not null references public.branches(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (hr_admin_id, branch_id)
);

alter table public.hr_branch_assignments enable row level security;

-- ---------------------------------------------------------------------
-- Helpers. SECURITY DEFINER so they bypass RLS on the tables they query,
-- the same reason private.is_hr_admin() already does (see init migration).
-- ---------------------------------------------------------------------
create or replace function private.is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.employees e
    where e.id = (select auth.uid())
      and e.role = 'super_admin'
      and e.active
  );
$$;

revoke all on function private.is_super_admin() from public;
grant execute on function private.is_super_admin() to authenticated;

create or replace function private.hr_branch_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select branch_id from public.hr_branch_assignments
  where hr_admin_id = (select auth.uid());
$$;

revoke all on function private.hr_branch_ids() from public;
grant execute on function private.hr_branch_ids() to authenticated;

-- Every employee a scoped HR admin is allowed to see: their assigned
-- branches, plus anyone with no default branch. Reused by every RLS
-- policy below and by every later migration that scopes to HR.
create or replace function private.hr_visible_employee_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select id from public.employees
  where default_branch_id in (select private.hr_branch_ids())
     or default_branch_id is null;
$$;

revoke all on function private.hr_visible_employee_ids() from public;
grant execute on function private.hr_visible_employee_ids() to authenticated;

-- ---- hr_branch_assignments: super_admin manages, hr_admin reads own ------
drop policy if exists "hr_branch_assignments read own or super" on public.hr_branch_assignments;
create policy "hr_branch_assignments read own or super"
  on public.hr_branch_assignments for select
  to authenticated
  using (hr_admin_id = (select auth.uid()) or private.is_super_admin());

drop policy if exists "hr_branch_assignments managed by super" on public.hr_branch_assignments;
create policy "hr_branch_assignments managed by super"
  on public.hr_branch_assignments for all
  to authenticated
  using (private.is_super_admin())
  with check (private.is_super_admin());

grant select, insert, update, delete on public.hr_branch_assignments to authenticated;

-- ---- employees: scope HR visibility to assigned branches ----------------
drop policy if exists "employees read own row" on public.employees;
create policy "employees read own row"
  on public.employees for select
  to authenticated
  using (
    (select auth.uid()) = id
    or private.is_super_admin()
    or (private.is_hr_admin() and id in (select private.hr_visible_employee_ids()))
  );

drop policy if exists "employees insertable by hr" on public.employees;
create policy "employees insertable by hr"
  on public.employees for insert
  to authenticated
  with check (private.is_hr_admin() or private.is_super_admin());

drop policy if exists "employees managed by hr" on public.employees;
create policy "employees managed by hr"
  on public.employees for update
  to authenticated
  using (
    private.is_super_admin()
    or (private.is_hr_admin() and id in (select private.hr_visible_employee_ids()))
  )
  with check (
    private.is_super_admin()
    or (private.is_hr_admin() and id in (select private.hr_visible_employee_ids()))
  );

-- ---- attendance: scope HR visibility to assigned branches ---------------
drop policy if exists "attendance read own or hr" on public.attendance;
create policy "attendance read own or hr"
  on public.attendance for select
  to authenticated
  using (
    (select auth.uid()) = employee_id
    or private.is_super_admin()
    or (private.is_hr_admin() and employee_id in (select private.hr_visible_employee_ids()))
  );

drop policy if exists "attendance update by hr" on public.attendance;
create policy "attendance update by hr"
  on public.attendance for update
  to authenticated
  using (
    private.is_super_admin()
    or (private.is_hr_admin() and employee_id in (select private.hr_visible_employee_ids()))
  )
  with check (
    private.is_super_admin()
    or (private.is_hr_admin() and employee_id in (select private.hr_visible_employee_ids()))
  );

-- ---- branches: creation is super_admin only; scoped edit for assigned --
drop policy if exists "branches insertable by hr" on public.branches;
create policy "branches insertable by super admin"
  on public.branches for insert
  to authenticated
  with check (private.is_super_admin());

drop policy if exists "branches updatable by hr" on public.branches;
create policy "branches updatable by hr or assigned admin"
  on public.branches for update
  to authenticated
  using (
    private.is_super_admin()
    or (private.is_hr_admin() and id in (select private.hr_branch_ids()))
  )
  with check (
    private.is_super_admin()
    or (private.is_hr_admin() and id in (select private.hr_branch_ids()))
  );
