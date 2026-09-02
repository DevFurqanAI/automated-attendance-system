-- Restore service_role's privileges on public.audit_log.
--
-- 20260831160000_restore_service_role_grants.sql re-granted service_role
-- "all on all tables in schema public" (plus a default-privileges rule for
-- tables created afterwards), which should already cover audit_log since it
-- existed before that migration ran. This migration exists because
-- "permission denied for table audit_log" (42501) is still being hit by the
-- service-role client (createAdminClient(), used when writing audit rows
-- from API routes) — so either that broad grant was never applied to this
-- database, or something since re-revoked it for this table specifically.
--
-- Re-issuing the grant here is idempotent and safe to run even if
-- 20260831160000 already applied cleanly.

grant usage on schema public to service_role;

grant select, insert, update, delete, references, trigger
on table public.audit_log
to service_role;

-- Belt-and-braces: re-apply the project-wide grant too, in case
-- audit_log was not the only table missed.
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;

alter default privileges in schema public grant all on tables to service_role;
alter default privileges in schema public grant all on sequences to service_role;
