-- Fix: "permission denied for table audit_log" (42501) for the authenticated
-- role via PostgREST, e.g. GET /rest/v1/audit_log from the HR audit page.
--
-- 20260824092000_audit_log.sql added the "audit readable by hr" RLS policy
-- for `authenticated`, and revoked insert/update/delete/truncate/references
-- from anon/authenticated — but never granted SELECT to authenticated in the
-- first place. RLS only filters rows once a role already has the underlying
-- table-level privilege; without it PostgREST fails before RLS is even
-- evaluated, regardless of the policy. The error's own hint confirms this:
-- "Grant the required privileges to the current role with:
--  GRANT SELECT ON public.audit_log TO authenticated;"
--
-- Safe: the RLS policy (private.is_hr_admin() or private.is_super_admin())
-- still restricts which rows a non-HR authenticated user can actually see.

grant select on table public.audit_log to authenticated;

-- PostgREST caches table privileges/roles at startup and after schema DDL;
-- a plain GRANT (which isn't itself a schema-shape change it watches for)
-- can be invisible to it until the cache is told to reload.
notify pgrst, 'reload schema';
