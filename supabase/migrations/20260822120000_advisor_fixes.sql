-- =====================================================================
-- Fixes raised by `supabase advisors` after the initial migration.
-- =====================================================================

-- ---------------------------------------------------------------------
-- SECURITY: public.rls_auto_enable() is RPC-callable by anon/authenticated
-- ---------------------------------------------------------------------
-- This function is an event-trigger handler (`ensure_rls`) that auto-enables
-- RLS on newly created public tables. It pre-dates this project — it is not
-- created by our migrations — and the behaviour itself is a useful safety net,
-- so it is left in place.
--
-- The problem is only its reachability: Postgres grants EXECUTE to PUBLIC on
-- every new function, which exposes it at /rest/v1/rpc/rls_auto_enable to both
-- `anon` and `authenticated`. Revoking EXECUTE does NOT affect the event
-- trigger — event triggers are fired by the system as the function's owner and
-- do not consult EXECUTE grants.
--
-- Guarded so this migration still applies cleanly to a project that has never
-- had the function.
do $$
begin
  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'rls_auto_enable'
  ) then
    revoke all on function public.rls_auto_enable() from public;
    revoke all on function public.rls_auto_enable() from anon, authenticated;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- PERFORMANCE: foreign keys without a covering index
-- ---------------------------------------------------------------------
-- Postgres does not index the referencing side of a FK automatically. Without
-- these, deleting or updating the referenced row forces a sequential scan, and
-- both of these are queried directly by the app.

-- Used when showing "reviewed by" and when an HR account is deactivated.
create index if not exists attendance_reviewed_by_idx
  on public.attendance (reviewed_by)
  where reviewed_by is not null;

-- Used by the employee management page and on branch deletion.
create index if not exists employees_default_branch_idx
  on public.employees (default_branch_id)
  where default_branch_id is not null;

-- Note: the advisor also reports attendance_employee_time_idx,
-- attendance_branch_time_idx and attendance_review_queue_idx as "unused".
-- That is expected on a freshly seeded database with no traffic yet — they
-- back the history view, the branch report filter, and the HR review queue
-- respectively. Re-check after the pilot rather than dropping them now.
