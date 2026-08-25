-- supabase/migrations/20260825092000_is_working_day_branchless_default.sql
-- =====================================================================
-- Fix: a branch-less employee with no personal weekly_off_days override
-- never got a day off.
-- =====================================================================
-- is_working_day() falls back from the employee's own weekly_off_days to
-- their branch's, but only when default_branch_id is not null. An employee
-- with neither — no branch, and no override ever set on their own row — fell
-- through to `v_off_days is null`, which the final `return not (...)` treats
-- as "no days off, ever". A fully-remote employee HR forgets to set an
-- override for would accrue an absence every Saturday and Sunday.
--
-- Defaults such an employee to the same {0} (Sunday) the branches table
-- itself defaults to (see 20260824101000_schedule_holidays.sql) — a safety
-- net, not a replacement for HR setting a real override via
-- PATCH /api/hr/employees (see 20260825093000_employee_weekly_off_days_patch
-- companion app change).
-- =====================================================================

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

  if v_off_days is null then
    if v_branch_id is not null then
      select weekly_off_days into v_off_days
        from public.branches
       where id = v_branch_id;
    else
      -- No branch to inherit from and no personal override set: default to
      -- Sunday off rather than treating every day as a working day.
      v_off_days := array[0]::smallint[];
    end if;
  end if;

  return not (v_off_days is not null and v_weekday = any(v_off_days));
end;
$$;
