-- supabase/migrations/20260824101000_schedule_holidays.sql
-- =====================================================================
-- Weekly work schedule + branch holiday calendar.
--
-- Precedence for whether a given (employee, date) is a working day, high to
-- low: branch_calendar_days 'mandatory_workday' > 'holiday' > the
-- employee's own weekly_off_days (if set) else their branch's. See
-- docs/superpowers/specs/2026-08-24-absence-leave-hr-scoping-design.md.
-- =====================================================================

alter table public.branches
  add column if not exists weekly_off_days smallint[] not null default '{0}';
alter table public.branches
  drop constraint if exists branches_weekly_off_days_valid;
alter table public.branches
  add constraint branches_weekly_off_days_valid
  check (weekly_off_days <@ array[0,1,2,3,4,5,6]::smallint[]);

alter table public.employees
  add column if not exists weekly_off_days smallint[];
alter table public.employees
  drop constraint if exists employees_weekly_off_days_valid;
alter table public.employees
  add constraint employees_weekly_off_days_valid
  check (weekly_off_days is null or weekly_off_days <@ array[0,1,2,3,4,5,6]::smallint[]);

create table if not exists public.branch_calendar_days (
  id         uuid primary key default gen_random_uuid(),
  branch_id  uuid not null references public.branches(id) on delete cascade,
  date       date not null,
  kind       text not null check (kind in ('holiday', 'mandatory_workday')),
  label      text,
  created_at timestamptz not null default now(),
  unique (branch_id, date)
);

alter table public.branch_calendar_days enable row level security;

drop policy if exists "branch_calendar_days readable by authenticated" on public.branch_calendar_days;
create policy "branch_calendar_days readable by authenticated"
  on public.branch_calendar_days for select
  to authenticated
  using (true);

drop policy if exists "branch_calendar_days managed by scoped hr" on public.branch_calendar_days;
create policy "branch_calendar_days managed by scoped hr"
  on public.branch_calendar_days for all
  to authenticated
  using (
    private.is_super_admin()
    or (private.is_hr_admin() and branch_id in (select private.hr_branch_ids()))
  )
  with check (
    private.is_super_admin()
    or (private.is_hr_admin() and branch_id in (select private.hr_branch_ids()))
  );

grant select, insert, update, delete on public.branch_calendar_days to authenticated;

create index if not exists branch_calendar_days_branch_date_idx
  on public.branch_calendar_days (branch_id, date);

-- ---------------------------------------------------------------------
-- is_working_day: the one place the precedence rule lives. Used by both
-- the nightly absence job and reporting queries.
-- ---------------------------------------------------------------------
create or replace function private.is_working_day(p_employee_id uuid, p_date date)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_branch_id uuid;
  v_weekday smallint;
  v_off_days smallint[];
  v_kind text;
begin
  select default_branch_id, weekly_off_days
    into v_branch_id, v_off_days
    from public.employees
   where id = p_employee_id;

  v_weekday := extract(dow from p_date)::smallint; -- 0=Sunday..6=Saturday

  if v_branch_id is not null then
    select kind into v_kind
      from public.branch_calendar_days
     where branch_id = v_branch_id and date = p_date;

    if v_kind = 'mandatory_workday' then
      return true;
    end if;
    if v_kind = 'holiday' then
      return false;
    end if;
  end if;

  if v_off_days is null and v_branch_id is not null then
    select weekly_off_days into v_off_days
      from public.branches
     where id = v_branch_id;
  end if;

  return not (v_off_days is not null and v_weekday = any(v_off_days));
end;
$$;

revoke all on function private.is_working_day(uuid, date) from public;
grant execute on function private.is_working_day(uuid, date) to authenticated;

-- ---------------------------------------------------------------------
-- branches_public gains the new column — grants are additive per-column,
-- so the narrower grant from the init migration needs the column added too.
-- ---------------------------------------------------------------------
-- `create or replace view` cannot reorder or insert existing columns, only
-- append new ones at the end — weekly_off_days must come after created_at.
create or replace view public.branches_public
  with (security_invoker = true) as
  select id, name, latitude, longitude, radius_meters, qr_version, created_at, weekly_off_days
  from public.branches;

grant select (id, name, latitude, longitude, radius_meters, qr_version, created_at, weekly_off_days)
  on public.branches to authenticated;
