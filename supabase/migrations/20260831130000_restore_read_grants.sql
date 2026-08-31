-- Restore read access for authenticated users.
-- RLS still decides which rows each user may see.

grant select on table public.attendance to authenticated;
grant select on table public.notifications to authenticated;