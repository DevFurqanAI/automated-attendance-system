-- supabase/migrations/20260824103000_absences.sql
create table if not exists public.absences (
  id          uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  branch_id   uuid references public.branches(id) on delete set null,
  date        date not null,
  created_at  timestamptz not null default now(),
  unique (employee_id, date)
);

create index if not exists absences_employee_date_idx
  on public.absences (employee_id, date desc);

alter table public.absences enable row level security;
alter table public.absences replica identity full;

drop policy if exists "absences read own or hr" on public.absences;
create policy "absences read own or hr"
  on public.absences for select
  to authenticated
  using (
    (select auth.uid()) = employee_id
    or private.is_super_admin()
    or (private.is_hr_admin() and employee_id in (select private.hr_visible_employee_ids()))
  );

-- No insert/update/delete policy for `authenticated`: rows are written only
-- by private.mark_daily_absences() (SECURITY DEFINER, run via pg_cron — see
-- the 20260824104000 migration) and deleted only through the service-role
-- client from the leave/attendance approval routes, which bypass RLS after
-- their own application-level permission check (same pattern as every other
-- HR write in this codebase).
revoke all on public.absences from anon, authenticated;
grant select on public.absences to authenticated;
