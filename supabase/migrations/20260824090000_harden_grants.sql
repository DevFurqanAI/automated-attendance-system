-- =====================================================================
-- Hardening: take write privileges away from the API roles
-- =====================================================================
-- THE HOLE THIS CLOSES
--
-- Supabase grants `anon` and `authenticated` full CRUD on every table in
-- `public` by default, and relies entirely on RLS to gate it. The RLS policy
-- guarding inserts was:
--
--     create policy "attendance insert own" on public.attendance for insert
--       to authenticated
--       with check ((select auth.uid()) = employee_id);
--
-- It constrains WHO the row belongs to and nothing else — not `status`, not
-- `method`, not the times. So any signed-in employee, using the publishable
-- key that ships in the page source plus their own ordinary login, could POST
-- straight to PostgREST:
--
--     insert into attendance (employee_id, branch_id, method, status,
--                             check_in_time, check_out_time)
--     values (me, any_branch, 'qr_gps', 'approved', <any>, <any>);
--
-- ...and book a full shift from anywhere, with no QR scan, no GPS fix, no
-- spoofing checks, no 2-day claim window and no review queue. It lands in the
-- payroll CSV directly, because reports read `status = 'approved'`.
--
-- WHY REVOKING IS SAFE
--
-- Every write in this app already goes through an API route holding the
-- service role (`createAdminClient`), which bypasses RLS and grants alike:
-- check-in, check-out, remote requests, HR review, branch and employee
-- management. No browser code calls .insert/.update/.delete — verified across
-- src/components and src/app/(app). So the API roles need SELECT and nothing
-- more, and the server keeps deciding every status it writes.
--
-- The RLS write policies are deliberately LEFT IN PLACE below the revokes.
-- Grants and policies are independent gates: if a future migration or a
-- Supabase default-privilege change hands the grants back, the policies are
-- still standing.
-- =====================================================================

-- ---- attendance -----------------------------------------------------
-- The critical one. SELECT stays: staff read their own rows and HR reads all,
-- both mediated by the existing "attendance read own or hr" policy, and the
-- realtime subscription on the review queue needs it too.
revoke insert, update, delete, truncate, references
  on public.attendance from anon, authenticated;

-- ---- employees ------------------------------------------------------
-- Roles and the active flag live here. A write grant on this table is a
-- privilege-escalation primitive: it is what "promote myself to hr_admin"
-- would need.
revoke insert, update, delete, truncate, references
  on public.employees from anon, authenticated;

-- ---- branches -------------------------------------------------------
-- `qr_secret` was readable-proof (excluded from the column-level SELECT grant
-- in the initial migration) but WRITABLE: the blanket
-- `grant insert, update on public.branches to authenticated` covered every
-- column. An HR admin could therefore set a branch's signing secret to a value
-- of their choosing through the Data API and mint QR tokens that verify — the
-- one thing the per-branch-secret design exists to prevent.
revoke insert, update, delete, truncate, references
  on public.branches from anon, authenticated;

-- ---------------------------------------------------------------------
-- Belt and braces: stop future tables in `public` from being born with the
-- same blanket write grants. This only affects objects created later BY THIS
-- ROLE; existing tables are handled by the explicit revokes above.
-- ---------------------------------------------------------------------
alter default privileges in schema public
  revoke insert, update, delete on tables from anon, authenticated;

-- ---------------------------------------------------------------------
-- Restate the intent of the surviving insert policy, which is now a second
-- line of defence rather than the only one.
-- ---------------------------------------------------------------------
comment on policy "attendance insert own" on public.attendance is
  'Defence in depth only. `authenticated` holds no INSERT grant on this table '
  '(see 20260824090000_harden_grants.sql); all writes go through the service '
  'role in the API routes. This policy is what stands if the grant is ever '
  'restored by accident.';
