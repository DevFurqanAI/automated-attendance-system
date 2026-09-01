-- Restore service_role's project-wide table access.
--
-- A fresh Supabase project grants service_role ALL PRIVILEGES on every table
-- in `public` by default (and on every table created afterwards, via a
-- default-privileges rule) — that default is why none of this project's
-- earlier migrations ever had to grant service_role anything explicitly.
-- Somewhere along the way that default grant was stripped project-wide, and
-- the two migrations just before this one (20260831130000, 20260831150000)
-- only re-granted it table-by-table for whichever table broke first
-- (attendance, notifications, employees) — every other table the app's
-- service-role client touches (branches, disputes, leave_requests, absences,
-- branch_calendar_days, hr_branch_assignments, audit_log, ...) was still
-- missing it, surfacing as "permission denied for table branches" once HR
-- tried to rotate a QR code.
--
-- service_role is only ever used by trusted server-side code
-- (createAdminClient() in src/lib/supabase/server.ts) and out-of-band admin
-- scripts — never by the browser. It is meant to bypass RLS and hold full
-- access; every route that uses it re-checks authorization in application
-- code first (see src/lib/hr-scope.ts). Restoring the blanket grant (and the
-- default-privileges rule, so this cannot silently regress again for a table
-- added later) is the fix, not another table-by-table patch.

grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;

alter default privileges in schema public grant all on tables to service_role;
alter default privileges in schema public grant all on sequences to service_role;
