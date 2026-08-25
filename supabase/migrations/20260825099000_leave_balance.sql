-- supabase/migrations/20260825099000_leave_balance.sql
-- =====================================================================
-- Leave balance tracking (informational, not enforced).
-- =====================================================================
-- An annual day count per employee, HR-editable, shown against approved
-- leave used so far this year on the employee's own leave page. Consistent
-- with the rest of this system's philosophy — see the "never a submission
-- gate" comment on daysInRangeWithinYear() in src/lib/attendance/leave.ts —
-- a request that would exceed the balance is still submitted and still
-- reviewed by HR, not silently rejected. This is visibility, not policy
-- enforcement.
-- =====================================================================

alter table public.employees
  add column if not exists leave_balance_days numeric(5,1) not null default 20;
alter table public.employees
  drop constraint if exists employees_leave_balance_days_valid;
alter table public.employees
  add constraint employees_leave_balance_days_valid
  check (leave_balance_days >= 0);

-- No grant or RLS change needed: public.employees keeps its blanket SELECT
-- grant to authenticated (20260824090000_harden_grants.sql revoked only
-- insert/update/delete), and the existing "employees read own row" policy
-- already covers every column on the row, this one included.
