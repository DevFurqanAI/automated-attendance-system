import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Notification dispatch.
 *
 * One entry point, two channels. The in-app channel is the row in
 * `public.notifications` and always runs. The email channel is a no-op until
 * an SMTP transport is configured — this Supabase project is on a plan that
 * cannot send custom email (see scripts/configure-auth.mjs), so the shape is
 * here and the transport is not.
 *
 * Deliberately never throws. A notification is a side effect of an action the
 * user asked for; failing to deliver one must not fail the approval, the role
 * change, or the check-in that caused it.
 */

export type NotificationKind =
  | 'attendance_approved'
  | 'attendance_declined'
  | 'attendance_flagged'
  | 'remote_submitted'
  | 'review_needed'
  | 'role_changed'
  | 'account_deactivated';

export interface NotificationInput {
  recipientId: string;
  kind: NotificationKind;
  title: string;
  body?: string | null;
  entityType?: 'attendance' | 'employee' | 'branch' | null;
  entityId?: string | null;
}

export interface NotificationRow {
  id: string;
  recipient_id: string;
  kind: NotificationKind;
  title: string;
  body: string | null;
  entity_type: 'attendance' | 'employee' | 'branch' | null;
  entity_id: string | null;
  read_at: string | null;
  created_at: string;
}

/**
 * Sends one or more notifications. Batched into a single insert: approving a
 * remote request notifies the employee, and a new flag notifies every HR
 * admin, so multi-recipient is the normal case rather than the exception.
 */
export async function notify(
  admin: SupabaseClient,
  entries: NotificationInput[],
): Promise<void> {
  if (entries.length === 0) return;

  const { error } = await admin.from('notifications').insert(
    entries.map((e) => ({
      recipient_id: e.recipientId,
      kind: e.kind,
      title: e.title,
      body: e.body ?? null,
      entity_type: e.entityType ?? null,
      entity_id: e.entityId ?? null,
    })),
  );

  if (error) {
    console.error(`[notify] in-app delivery failed: ${error.message}`);
  }

  await sendByEmail(admin, entries);
}

/**
 * Every active HR administrator — the recipients for anything landing in the
 * review queue. Excludes `excludeId` so an HR admin who files their own remote
 * request is not told about it.
 */
export async function hrAdminIds(
  admin: SupabaseClient,
  excludeId?: string,
): Promise<string[]> {
  const { data, error } = await admin
    .from('employees')
    .select('id')
    .eq('role', 'hr_admin')
    .eq('active', true)
    .returns<{ id: string }[]>();

  if (error) {
    console.error(`[notify] could not list HR admins: ${error.message}`);
    return [];
  }
  return (data ?? []).map((r) => r.id).filter((id) => id !== excludeId);
}

// ---------------------------------------------------------------------------
// Email channel
// ---------------------------------------------------------------------------

/**
 * Whether email delivery is switched on. Off unless a transport is explicitly
 * configured, so a half-set-up environment silently does the right thing (in-app
 * only) instead of throwing on every action.
 */
export function emailEnabled(): boolean {
  return process.env.NOTIFY_EMAIL === 'on' && Boolean(process.env.SMTP_URL);
}

/**
 * Mirrors notifications out over email.
 *
 * Intentionally a stub with a real signature. When SMTP arrives, this is the
 * only function that changes: resolve each recipient's address, render the
 * same title/body, hand it to the transport. Everything upstream already
 * passes what it needs.
 */
async function sendByEmail(
  admin: SupabaseClient,
  entries: NotificationInput[],
): Promise<void> {
  if (!emailEnabled()) return;

  // Addresses are looked up here rather than passed in, so callers never have
  // to carry an email around just in case this channel is on.
  const { data, error } = await admin
    .from('employees')
    .select('id, email, full_name')
    .in('id', [...new Set(entries.map((e) => e.recipientId))])
    .returns<{ id: string; email: string; full_name: string }[]>();

  if (error) {
    console.error(`[notify] could not resolve recipients: ${error.message}`);
    return;
  }

  const byId = new Map((data ?? []).map((r) => [r.id, r]));

  for (const entry of entries) {
    const recipient = byId.get(entry.recipientId);
    if (!recipient) continue;

    // TODO(smtp): hand to the transport once one is configured. Logged rather
    // than silently dropped so a misconfigured environment is visible in the
    // Vercel logs instead of looking like delivery.
    console.info(
      `[notify:email] would send "${entry.title}" to ${recipient.email} ` +
        '(no transport configured)',
    );
  }
}
