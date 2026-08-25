-- supabase/migrations/20260825091000_absence_job_hire_date_guard.sql
-- =====================================================================
-- Fix: nightly absence job could mark a brand-new hire absent for a day
-- before they existed.
-- =====================================================================
-- mark_daily_absences() loops over every currently-active employee and marks
-- yesterday absent when there is no attendance/leave for them — with no check
-- against employees.created_at. An employee invited today gets evaluated
-- against yesterday's date same as everyone else: if that was a working day
-- at their branch, they are marked absent for a day before they were hired.
-- =====================================================================

create or replace function private.mark_daily_absences()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_target_date date := ((now() at time zone 'Asia/Karachi')::date - 1);
  v_employee record;
begin
  for v_employee in
    select id, default_branch_id from public.employees
    where active
      and (created_at at time zone 'Asia/Karachi')::date <= v_target_date
  loop
    if not private.is_working_day(v_employee.id, v_target_date) then
      continue;
    end if;

    -- Showing up at all — any status, not just approved — means not absent.
    if exists (
      select 1 from public.attendance
      where employee_id = v_employee.id
        and (
          (check_in_time at time zone 'Asia/Karachi')::date = v_target_date
          or (claimed_check_in_time at time zone 'Asia/Karachi')::date = v_target_date
        )
    ) then
      continue;
    end if;

    if exists (
      select 1 from public.leave_requests
      where employee_id = v_employee.id
        and status = 'approved'
        and v_target_date between from_date and to_date
    ) then
      continue;
    end if;

    insert into public.absences (employee_id, branch_id, date)
    values (v_employee.id, v_employee.default_branch_id, v_target_date)
    on conflict (employee_id, date) do nothing;
  end loop;
end;
$$;

revoke all on function private.mark_daily_absences() from public;
