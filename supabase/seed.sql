-- =====================================================================
-- Seed: the three physical branches (Multan).
-- =====================================================================
-- Coordinates supplied by the client, truncated to the numeric(9,6) column
-- precision (~0.1 m — far finer than any consumer GPS fix, so nothing is lost).
--
-- If a branch ever moves, or staff at one site are being flagged as
-- `out_of_range` too often, correct it from HR → Branches rather than editing
-- this file — the app writes straight to the table.
--
-- `qr_secret` and `qr_version` are intentionally omitted: the column defaults
-- generate a fresh random secret per branch, so each branch is immediately
-- printable from HR → Branches → Show QR code.
--
-- Re-running this file is safe: it inserts only branches whose name is absent.
-- =====================================================================

insert into public.branches (name, latitude, longitude, radius_meters)
select * from (values
  -- 30.241748188018178, 71.50268712772993
  ('Model Town Branch', 30.241748::numeric, 71.502687::numeric, 100),
  -- 30.229233959469, 71.47887515332445
  ('Chase Up Branch',   30.229234::numeric, 71.478875::numeric, 100),
  -- 30.291061, 71.510482
  ('DHA Main Branch',   30.291061::numeric, 71.510482::numeric, 100)
) as v(name, latitude, longitude, radius_meters)
where not exists (
  select 1 from public.branches b where b.name = v.name
);

-- ---------------------------------------------------------------------
-- Promoting the first HR administrator.
-- ---------------------------------------------------------------------
-- Signing up through the app creates an `employees` row with role
-- 'employee'. There is no way to promote yourself from inside the app
-- (by design), so the very first HR admin is created out-of-band:
--
--   npm run db:bootstrap-admin -- you@yourcompany.com "Your Name"
--
-- or, if the account already exists:
--
--   update public.employees
--      set role = 'hr_admin'
--    where email = 'you@yourcompany.com';
--
-- Every later HR admin can be promoted from HR → Employees.
