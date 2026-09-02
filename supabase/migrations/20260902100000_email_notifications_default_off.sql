-- Flip the default for email_notifications_enabled (added in
-- 20260825100000_notification_preferences.sql) from true to false.
--
-- New employees now start opted OUT of the email mirror; in-app
-- notifications are unaffected — see src/lib/notify.ts, "the in-app
-- channel... always runs". Only the column default changes here: existing
-- employees' own preference (whatever they already have) is left alone.

alter table public.employees
  alter column email_notifications_enabled set default false;
