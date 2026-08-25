-- supabase/migrations/20260825090000_audit_log_super_admin_read.sql
-- =====================================================================
-- Fix: super_admin could not read the audit log.
-- =====================================================================
-- The "audit readable by hr" policy (20260824092000_audit_log.sql) checks
-- private.is_hr_admin(), which tests `role = 'hr_admin'` literally (see
-- init migration) — it predates the super_admin tier introduced in
-- 20260824100000_hr_branch_scoping.sql and was never revisited. The result:
-- the one role meant to have unscoped oversight of every privileged action
-- was silently blocked from the table that records them, by RLS, not just
-- the page guard in src/app/(app)/hr/audit/page.tsx (fixed alongside this).
-- =====================================================================

drop policy if exists "audit readable by hr" on public.audit_log;
create policy "audit readable by hr"
  on public.audit_log for select
  to authenticated
  using (private.is_hr_admin() or private.is_super_admin());
