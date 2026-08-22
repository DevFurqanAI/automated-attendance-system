-- =====================================================================
-- Multi-Branch Staff Attendance System — initial schema
-- =====================================================================
-- Run this in the Supabase SQL editor, or via `supabase db push`.
--
-- Security model notes:
--  * Every table in `public` has RLS enabled (public is exposed to the
--    Data API, so RLS is the only thing standing between a leaked anon
--    key and the whole dataset).
--  * Role checks go through `private.is_hr_admin()`, a SECURITY DEFINER
--    function living in an UNEXPOSED schema. This is required to avoid
--    infinite recursion: an RLS policy on `employees` cannot itself
--    SELECT from `employees`.
--  * Roles live in `public.employees.role`, never in
--    `auth.users.raw_user_meta_data` — user_metadata is user-editable
--    and therefore unsafe for authorization decisions.
-- =====================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------
-- Private schema: helpers that must bypass RLS. Never exposed to the API.
-- ---------------------------------------------------------------------
create schema if not exists private;
revoke all on schema private from anon, authenticated;

-- ---------------------------------------------------------------------
-- branches
-- ---------------------------------------------------------------------
create table if not exists public.branches (
  id             uuid primary key default gen_random_uuid(),
  name           text          not null,
  latitude       numeric(9,6)  not null,
  longitude      numeric(9,6)  not null,
  radius_meters  integer       not null default 100 check (radius_meters > 0),
  -- Per-branch HMAC secret used to sign this branch's printed QR token.
  -- Rotating it instantly invalidates every previously printed code.
  qr_secret      text          not null default encode(gen_random_bytes(32), 'hex'),
  -- Bumped on every rotation and embedded in the token, so old prints stop verifying.
  qr_version     integer       not null default 1,
  created_at     timestamptz   not null default now()
);

-- ---------------------------------------------------------------------
-- employees  (id mirrors auth.users.id)
-- ---------------------------------------------------------------------
create table if not exists public.employees (
  id                uuid primary key references auth.users(id) on delete cascade,
  full_name         text        not null,
  email             text        not null unique,
  role              text        not null default 'employee'
                      check (role in ('employee', 'hr_admin')),
  default_branch_id uuid        references public.branches(id) on delete set null,
  active            boolean     not null default true,
  created_at        timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- attendance
-- ---------------------------------------------------------------------
create table if not exists public.attendance (
  id          uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  branch_id   uuid references public.branches(id) on delete set null,

  -- System-verified times. For remote_request rows these stay NULL until HR
  -- approves; reports read ONLY these columns, never the claims below.
  check_in_time  timestamptz,
  check_out_time timestamptz,

  -- Always stamped by the server at request time. Never client-supplied.
  submitted_at timestamptz not null default now(),

  -- Staff-asserted times. Only meaningful for method = 'remote_request'.
  claimed_check_in_time  timestamptz,
  claimed_check_out_time timestamptz,

  check_in_lat             numeric(9,6),
  check_in_lng             numeric(9,6),
  check_in_accuracy_meters numeric(10,2),
  check_out_lat            numeric(9,6),
  check_out_lng            numeric(9,6),

  method text not null check (method in ('qr_gps', 'remote_request')),
  status text not null check (status in ('approved', 'pending', 'flagged', 'declined')),

  flag_reason   text check (flag_reason in (
                  'mock_location_detected',
                  'impossible_travel',
                  'coordinate_jitter',
                  'out_of_range'
                )),
  remote_reason text,

  -- Reserved for a future optional selfie step. Intentionally unused.
  selfie_url text,

  reviewed_by uuid references public.employees(id) on delete set null,
  reviewed_at timestamptz,
  created_at  timestamptz not null default now(),

  -- A claim only ever belongs to a remote request.
  constraint claims_only_on_remote check (
    method = 'remote_request'
    or (claimed_check_in_time is null and claimed_check_out_time is null)
  ),
  -- Check-out can never precede check-in.
  constraint checkout_after_checkin check (
    check_out_time is null
    or check_in_time is null
    or check_out_time >= check_in_time
  )
);

-- At most one open (not yet checked out) QR shift per employee.
create unique index if not exists attendance_one_open_shift
  on public.attendance (employee_id)
  where check_out_time is null
    and method = 'qr_gps'
    and status in ('approved', 'flagged');

create index if not exists attendance_employee_time_idx
  on public.attendance (employee_id, check_in_time desc);
create index if not exists attendance_branch_time_idx
  on public.attendance (branch_id, check_in_time desc);
-- Drives the HR review dashboard.
create index if not exists attendance_review_queue_idx
  on public.attendance (status, submitted_at desc)
  where status in ('pending', 'flagged');

-- ---------------------------------------------------------------------
-- Role helper. SECURITY DEFINER so the policies on `employees` can call it
-- without recursing into `employees`' own RLS.
-- ---------------------------------------------------------------------
create or replace function private.is_hr_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.employees e
    where e.id = (select auth.uid())
      and e.role = 'hr_admin'
      and e.active
  );
$$;

-- Postgres grants EXECUTE to PUBLIC by default, which would turn this into a
-- callable API endpoint. Lock it down, then hand it back only to signed-in users.
revoke all on function private.is_hr_admin() from public;
grant usage on schema private to authenticated;
grant execute on function private.is_hr_admin() to authenticated;

-- ---------------------------------------------------------------------
-- Row-Level Security
-- ---------------------------------------------------------------------
alter table public.branches   enable row level security;
alter table public.employees  enable row level security;
alter table public.attendance enable row level security;

-- ---- branches -------------------------------------------------------
-- Everyone signed in may read branch metadata (needed to show branch names).
-- qr_secret is excluded at the column-grant level further down.
drop policy if exists "branches readable by authenticated" on public.branches;
create policy "branches readable by authenticated"
  on public.branches for select
  to authenticated
  using (true);

drop policy if exists "branches insertable by hr" on public.branches;
create policy "branches insertable by hr"
  on public.branches for insert
  to authenticated
  with check (private.is_hr_admin());

drop policy if exists "branches updatable by hr" on public.branches;
create policy "branches updatable by hr"
  on public.branches for update
  to authenticated
  using (private.is_hr_admin())
  with check (private.is_hr_admin());

-- Staff-safe projection: every branch column except the signing secret.
-- security_invoker so the view respects the caller's RLS rather than the
-- view owner's.
create or replace view public.branches_public
  with (security_invoker = true) as
  select id, name, latitude, longitude, radius_meters, qr_version, created_at
  from public.branches;

-- Column-level defence in depth: even with the SELECT policy above, the
-- authenticated role cannot read qr_secret.
revoke select on public.branches from anon, authenticated;
grant select (id, name, latitude, longitude, radius_meters, qr_version, created_at)
  on public.branches to authenticated;
grant insert, update on public.branches to authenticated;
grant select on public.branches_public to anon, authenticated;

-- ---- employees ------------------------------------------------------
drop policy if exists "employees read own row" on public.employees;
create policy "employees read own row"
  on public.employees for select
  to authenticated
  using ((select auth.uid()) = id or private.is_hr_admin());

drop policy if exists "employees insertable by hr" on public.employees;
create policy "employees insertable by hr"
  on public.employees for insert
  to authenticated
  with check (private.is_hr_admin());

drop policy if exists "employees managed by hr" on public.employees;
create policy "employees managed by hr"
  on public.employees for update
  to authenticated
  using (private.is_hr_admin())
  with check (private.is_hr_admin());

-- ---- attendance -----------------------------------------------------
drop policy if exists "attendance read own or hr" on public.attendance;
create policy "attendance read own or hr"
  on public.attendance for select
  to authenticated
  using ((select auth.uid()) = employee_id or private.is_hr_admin());

-- Staff may only ever create rows for themselves. The API routes do their
-- writes with the service role after validating the session; this policy is
-- what protects the table against direct Data API calls.
drop policy if exists "attendance insert own" on public.attendance;
create policy "attendance insert own"
  on public.attendance for insert
  to authenticated
  with check ((select auth.uid()) = employee_id);

-- Only HR may mutate an existing row (approve / decline / correct times).
-- Both USING and WITH CHECK are required, otherwise a reviewer could
-- reassign a row to a different employee.
drop policy if exists "attendance update by hr" on public.attendance;
create policy "attendance update by hr"
  on public.attendance for update
  to authenticated
  using (private.is_hr_admin())
  with check (private.is_hr_admin());

-- ---------------------------------------------------------------------
-- Realtime: the HR dashboard subscribes to the review queue.
-- ---------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'attendance'
  ) then
    alter publication supabase_realtime add table public.attendance;
  end if;
end $$;

-- Realtime UPDATE/DELETE payloads need the old row to evaluate RLS.
alter table public.attendance replica identity full;

-- ---------------------------------------------------------------------
-- New auth users automatically get an employees row (role: employee).
-- HR promotes to hr_admin from the employee management page.
-- ---------------------------------------------------------------------
create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.employees (id, full_name, email)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)),
    new.email
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();
