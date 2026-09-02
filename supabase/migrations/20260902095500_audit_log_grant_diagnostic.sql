-- Diagnostic only — not a fix. Run this alone (nothing before it in the same
-- paste) to check what `authenticated` currently holds on public.audit_log,
-- since the explicit `grant select ... to authenticated` plus a schema
-- reload notify still didn't clear the 42501 error.

select grantee, privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name = 'audit_log'
order by grantee, privilege_type;

-- Also confirm which database/project this connection is actually on —
-- rules out pasting into the wrong Supabase project or branch.
select current_database(), inet_server_addr(), current_setting('cluster_name', true);
