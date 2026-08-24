-- supabase/migrations/20260824102000_leave_requests.sql
create table if not exists public.leave_requests (
  id           uuid primary key default gen_random_uuid(),
  employee_id  uuid not null references public.employees(id) on delete cascade,
  from_date    date not null,
  to_date      date not null,
  reason       text not null,
  status       text not null default 'pending' check (status in ('pending', 'approved', 'declined')),
  reviewed_by  uuid references public.employees(id) on delete set null,
  reviewed_at  timestamptz,
  created_at   timestamptz not null default now(),

  constraint leave_to_after_from check (to_date >= from_date)
);

create index if not exists leave_requests_employee_idx
  on public.leave_requests (employee_id, from_date desc);
create index if not exists leave_requests_review_queue_idx
  on public.leave_requests (status, created_at desc)
  where status = 'pending';

alter table public.leave_requests enable row level security;
alter table public.leave_requests replica identity full;

drop policy if exists "leave_requests read own or hr" on public.leave_requests;
create policy "leave_requests read own or hr"
  on public.leave_requests for select
  to authenticated
  using (
    (select auth.uid()) = employee_id
    or private.is_super_admin()
    or (private.is_hr_admin() and employee_id in (select private.hr_visible_employee_ids()))
  );

drop policy if exists "leave_requests insert own" on public.leave_requests;
create policy "leave_requests insert own"
  on public.leave_requests for insert
  to authenticated
  with check ((select auth.uid()) = employee_id);

drop policy if exists "leave_requests update by hr" on public.leave_requests;
create policy "leave_requests update by hr"
  on public.leave_requests for update
  to authenticated
  using (
    private.is_super_admin()
    or (private.is_hr_admin() and employee_id in (select private.hr_visible_employee_ids()))
  )
  with check (
    private.is_super_admin()
    or (private.is_hr_admin() and employee_id in (select private.hr_visible_employee_ids()))
  );

grant select, insert, update on public.leave_requests to authenticated;
revoke delete on public.leave_requests from anon, authenticated;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'leave_requests'
  ) then
    alter publication supabase_realtime add table public.leave_requests;
  end if;
end $$;
