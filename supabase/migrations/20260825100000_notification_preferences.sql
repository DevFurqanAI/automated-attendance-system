-- supabase/migrations/20260825100000_notification_preferences.sql
-- =====================================================================
-- Per-employee email notification opt-out.
-- =====================================================================
-- Every notification always lands in-app (src/lib/notify.ts: "the in-app
-- channel... always runs") — that stays true. This only gates the email
-- mirror: an employee who finds the emails noisy can turn them off without
-- losing the in-app record, which is still authoritative (their history,
-- HR's audit trail, etc. all read from the notifications table, never from
-- whether an email happened to send).
-- =====================================================================

alter table public.employees
  add column if not exists email_notifications_enabled boolean not null default true;
