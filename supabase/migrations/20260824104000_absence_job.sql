-- supabase/migrations/20260824104000_absence_job.sql
-- =====================================================================
-- Nightly absence detection.
--
-- Runs at 21:00 UTC = 02:00 Asia/Karachi, evaluating the PKT calendar day
-- that just ended — late enough that a near-midnight checkout can't be
-- caught mid-shift. No notification is sent (HR checks reports, per the
-- design doc's explicit decision).
-- =====================================================================

create extension if not exists pg_cron with schema extensions;

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
    select id, default_branch_id from public.employees where active
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

do $$
begin
  if exists (select 1 from cron.job where jobname = 'mark-daily-absences') then
    perform cron.unschedule('mark-daily-absences');
  end if;
end $$;

select cron.schedule(
  'mark-daily-absences',
  '0 21 * * *',
  $$select private.mark_daily_absences();$$
);
