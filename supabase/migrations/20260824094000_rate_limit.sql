-- =====================================================================
-- Rate limiting
-- =====================================================================
-- The app's own endpoints had no throttle at all: check-in, check-out and
-- remote requests would accept as fast as a script could send them.
--
-- (Sign-in and password reset are NOT in scope here — those calls go from the
-- browser straight to Supabase Auth, which applies its own limits. This covers
-- the routes this codebase actually serves.)
--
-- Counters live in Postgres rather than in process memory because the app runs
-- on serverless functions: instances come and go and do not share state, so an
-- in-memory counter would reset at the worst possible moment and enforce
-- nothing under the load that matters.
--
-- Fixed windows, not a sliding log. A fixed window allows a burst at a window
-- boundary, which is the accepted trade for one row and one statement per
-- request instead of a growing list per caller.
-- =====================================================================

create table if not exists private.rate_limit (
  bucket       text        not null,
  window_start timestamptz not null,
  count        integer     not null default 0,
  primary key (bucket, window_start)
);

comment on table private.rate_limit is
  'Fixed-window request counters. In the private schema, so it is unreachable '
  'through the Data API regardless of grants.';

create index if not exists rate_limit_window_idx
  on private.rate_limit (window_start);

-- ---------------------------------------------------------------------
-- Records one hit and reports whether it is allowed.
--
-- Lives in `public` because PostgREST only exposes that schema and the API
-- routes reach it over RPC — but EXECUTE is revoked from the API roles, so
-- only the service role can call it. SECURITY DEFINER so it can touch the
-- private table.
-- ---------------------------------------------------------------------
create or replace function public.rate_limit_hit(
  p_bucket         text,
  p_limit          integer,
  p_window_seconds integer
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_window_start timestamptz;
  v_count        integer;
begin
  -- Snap to the start of the current fixed window.
  v_window_start := to_timestamp(
    floor(extract(epoch from clock_timestamp()) / p_window_seconds) * p_window_seconds
  );

  insert into private.rate_limit as rl (bucket, window_start, count)
  values (p_bucket, v_window_start, 1)
  on conflict (bucket, window_start)
    do update set count = rl.count + 1
  returning rl.count into v_count;

  -- Opportunistic housekeeping: roughly one call in a hundred clears out
  -- windows nobody will read again. Cheaper than a scheduled job for a table
  -- this small, and it cannot pile up because every caller shares the chance.
  if random() < 0.01 then
    delete from private.rate_limit where window_start < clock_timestamp() - interval '1 day';
  end if;

  return v_count <= p_limit;
end;
$$;

-- Postgres grants EXECUTE to PUBLIC by default. Without this, a signed-in user
-- could call the limiter directly and burn through anyone's budget by naming
-- their bucket.
revoke all on function public.rate_limit_hit(text, integer, integer) from public;
revoke all on function public.rate_limit_hit(text, integer, integer) from anon, authenticated;
grant execute on function public.rate_limit_hit(text, integer, integer) to service_role;
