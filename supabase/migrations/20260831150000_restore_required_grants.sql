-- Restore the table privileges required by the application.
--
-- RLS remains responsible for deciding which rows authenticated users
-- are allowed to read. These grants only allow the SELECT operation
-- to reach the RLS policy layer.
--
-- service_role is used only by trusted server-side code and admin scripts.

-- Authenticated users must be able to read their own/profile-scoped data.
grant select on table public.attendance to authenticated;
grant select on table public.notifications to authenticated;
grant select on table public.employees to authenticated;

-- Trusted server-side operations need full CRUD access to employees.
grant select, insert, update, delete
on table public.employees
to service_role;