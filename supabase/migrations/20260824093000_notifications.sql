-- =====================================================================
-- notifications — tell people what happened to them
-- =====================================================================
-- Nothing in the system told anyone anything. An employee whose remote request
-- was declined found out by going and looking; an HR admin found out about a
-- flagged check-in only if the dashboard happened to be open in a tab.
--
-- In-app rather than email, because this Supabase project cannot send custom
-- email without SMTP (see scripts/configure-auth.mjs). The dispatcher in
-- src/lib/notify.ts writes these rows and, when an email transport is
-- configured, mirrors them out — so adding SMTP later is configuration, not a
-- rewrite.
-- =====================================================================

create table if not exists public.notifications (
  id           uuid primary key default gen_random_uuid(),

  recipient_id uuid not null references public.employees(id) on delete cascade,

  kind text not null check (kind in (
    'attendance_approved',
    'attendance_declined',
    'attendance_flagged',
    'remote_submitted',
    'review_needed',
    'role_changed',
    'account_deactivated'
  )),

  title text not null,
  body  text,

  -- What to link to when the notification is clicked.
  entity_type text check (entity_type in ('attendance', 'employee', 'branch')),
  entity_id   uuid,

  read_at    timestamptz,
  created_at timestamptz not null default now()
);

comment on table public.notifications is
  'Per-recipient in-app notifications. Written by the service role via '
  'src/lib/notify.ts; marked read through /api/notifications/read.';

-- The bell reads "my unread, newest first" on every page load, so that is the
-- index. Partial on unread keeps it small as history accumulates.
create index if not exists notifications_recipient_idx
  on public.notifications (recipient_id, created_at desc);
create index if not exists notifications_unread_idx
  on public.notifications (recipient_id)
  where read_at is null;

alter table public.notifications enable row level security;

-- You may read your own, and nobody else's — not even HR. A notification can
-- quote the reason a shift was flagged, which is between the employee and the
-- reviewer.
drop policy if exists "notifications read own" on public.notifications;
create policy "notifications read own"
  on public.notifications for select
  to authenticated
  using ((select auth.uid()) = recipient_id);

-- No write policy: creation and read-marking both go through the service role.
revoke insert, update, delete, truncate, references
  on public.notifications from anon, authenticated;
