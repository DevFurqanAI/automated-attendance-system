-- supabase/migrations/20260825103000_company_wide_calendar.sql
-- =====================================================================
-- Company-wide holidays — a shared calendar, not just per-branch.
-- =====================================================================
-- branch_calendar_days was branch-only: declaring a company holiday meant
-- re-entering it once per branch. branch_id is now nullable — null means
-- "every branch, and every branch-less employee too" — with a branch-
-- specific entry for the same date still taking precedence (a branch can
-- opt out of / override a company holiday, same override shape as the
-- employee/branch weekly_off_days precedence).
--
-- unique(branch_id, date) does NOT stop two null-branch rows for the same
-- date (Postgres treats NULL as distinct from itself in a plain unique
-- constraint) — the partial index below is what actually enforces "one
-- company-wide entry per date".
--
-- Creating a company-wide entry (branch_id null) is super_admin-only: it
-- affects every branch, not just what a scoped hr_admin manages.
-- =====================================================================

alter table public.branch_calendar_days
  alter column branch_id drop not null;

create unique index if not exists branch_calendar_days_company_wide_date_idx
  on public.branch_calendar_days (date)
  where branch_id is null;

drop policy if exists "branch_calendar_days managed by scoped hr" on public.branch_calendar_days;
create policy "branch_calendar_days managed by scoped hr"
  on public.branch_calendar_days for all
  to authenticated
  using (
    private.is_super_admin()
    or (
      private.is_hr_admin()
      and branch_id is not null
      and branch_id in (select private.hr_branch_ids())
    )
  )
  with check (
    private.is_super_admin()
    or (
      private.is_hr_admin()
      and branch_id is not null
      and branch_id in (select private.hr_branch_ids())
    )
  );

-- ---------------------------------------------------------------------
-- is_working_day(): check the branch-specific entry first, fall back to
-- the company-wide one. A branch-less employee only ever sees the
-- company-wide calendar (there is no branch entry to check).
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
  end if;

  if v_kind is null then
    select kind into v_kind
      from public.branch_calendar_days
     where branch_id is null and date = p_date;
  end if;

  if v_kind = 'mandatory_workday' then
    return true;
  end if;
  if v_kind = 'holiday' then
    return false;
  end if;

  if v_off_days is null then
    if v_branch_id is not null then
      select weekly_off_days into v_off_days
        from public.branches
       where id = v_branch_id;
    else
      v_off_days := array[0]::smallint[];
    end if;
  end if;

  return not (v_off_days is not null and v_weekday = any(v_off_days));
end;
$$;
