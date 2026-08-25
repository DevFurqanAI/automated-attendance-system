import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Notification dispatch.
 *
 * One entry point, two channels. The in-app channel is the row in
 * `public.notifications` and always runs. The email channel sends through
 * Resend (see the "Email channel" section below) and is off unless
 * NOTIFY_EMAIL=on and RESEND_API_KEY are both set — this Supabase project is
 * on a plan that cannot send its own custom auth email (see
 * scripts/configure-auth.mjs), which is unrelated to this app-level channel.
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
  | 'leave_submitted'
  | 'leave_approved'
  | 'leave_declined'
  | 'review_needed'
  | 'role_changed'
  | 'account_deactivated'
  | 'email_changed'
  | 'marked_absent'
  | 'attendance_corrected'
  | 'dispute_submitted'
  | 'dispute_resolved';

export interface NotificationInput {
  recipientId: string;
  kind: NotificationKind;
  title: string;
  body?: string | null;
  entityType?: 'attendance' | 'employee' | 'branch' | 'leave_request' | null;
  entityId?: string | null;
}

export interface NotificationRow {
  id: string;
  recipient_id: string;
  kind: NotificationKind;
  title: string;
  body: string | null;
  entity_type: 'attendance' | 'employee' | 'branch' | 'leave_request' | null;
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
 * Every active HR administrator, at any tier (hr_admin or super_admin) — the
 * recipients for anything landing in the review queue. Excludes `excludeId`
 * so an HR admin who files their own remote request is not told about it.
 */
export async function hrAdminIds(
  admin: SupabaseClient,
  excludeId?: string,
): Promise<string[]> {
  const { data, error } = await admin
    .from('employees')
    .select('id')
    .in('role', ['hr_admin', 'super_admin'])
    .eq('active', true)
    .returns<{ id: string }[]>();

  if (error) {
    console.error(`[notify] could not list HR admins: ${error.message}`);
    return [];
  }
  return (data ?? []).map((r) => r.id).filter((id) => id !== excludeId);
}

/**
 * The HR admin(s) who should be notified about `employeeId` — their assigned
 * branch's HR admin(s) if scoped, or every HR admin if the employee has no
 * default branch — plus every super_admin. Mirrors the RLS visibility rule
 * in private.hr_visible_employee_ids() so "who gets notified" and "who can
 * see it in the review queue" never disagree.
 */
export async function scopedHrRecipientIds(
  admin: SupabaseClient,
  employeeId: string,
  excludeId?: string,
): Promise<string[]> {
  const { data: employee } = await admin
    .from('employees')
    .select('default_branch_id')
    .eq('id', employeeId)
    .single<{ default_branch_id: string | null }>();

  const { data: admins, error } = await admin
    .from('employees')
    .select('id, role')
    .in('role', ['hr_admin', 'super_admin'])
    .eq('active', true)
    .returns<{ id: string; role: string }[]>();

  if (error || !admins) {
    console.error(`[notify] could not list HR recipients: ${error?.message}`);
    return [];
  }

  if (!employee || employee.default_branch_id === null) {
    return admins.map((a) => a.id).filter((id) => id !== excludeId);
  }

  const { data: assignments } = await admin
    .from('hr_branch_assignments')
    .select('hr_admin_id')
    .eq('branch_id', employee.default_branch_id)
    .returns<{ hr_admin_id: string }[]>();

  const scopedIds = new Set((assignments ?? []).map((a) => a.hr_admin_id));

  return admins
    .filter((a) => a.role === 'super_admin' || scopedIds.has(a.id))
    .map((a) => a.id)
    .filter((id) => id !== excludeId);
}

// ---------------------------------------------------------------------------
// Email channel — Resend (https://resend.com)
// ---------------------------------------------------------------------------

/**
 * Whether email delivery is switched on. Off unless a transport is explicitly
 * configured, so a half-set-up environment silently does the right thing (in-app
 * only) instead of throwing on every action.
 *
 * NOTIFY_FROM_EMAIL defaults to Resend's shared test sender, which only
 * delivers to the address on the Resend account itself — real delivery to
 * every recipient requires a verified domain and NOTIFY_FROM_EMAIL pointing
 * at an address on it (see https://resend.com/domains).
 */
export function emailEnabled(): boolean {
  return process.env.NOTIFY_EMAIL === 'on' && Boolean(process.env.RESEND_API_KEY);
}

let resendClient: import('resend').Resend | null = null;

async function getResendClient(): Promise<import('resend').Resend> {
  if (!resendClient) {
    const { Resend } = await import('resend');
    resendClient = new Resend(process.env.RESEND_API_KEY);
  }
  return resendClient;
}

/**
 * Mirrors notifications out over email via Resend. Sent one call per
 * recipient rather than batched — Resend's batch endpoint shares one
 * from/subject across the whole batch, which does not fit these being
 * different notifications with different titles.
 *
 * Never throws: a failed send is logged and the next recipient still gets
 * theirs, matching the "never blocks the action that caused it" contract on
 * `notify()`.
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
    .select('id, email, full_name, email_notifications_enabled')
    .in('id', [...new Set(entries.map((e) => e.recipientId))])
    .returns<
      { id: string; email: string; full_name: string; email_notifications_enabled: boolean }[]
    >();

  if (error) {
    console.error(`[notify] could not resolve recipients: ${error.message}`);
    return;
  }

  const byId = new Map((data ?? []).map((r) => [r.id, r]));
  const from = process.env.NOTIFY_FROM_EMAIL ?? 'onboarding@resend.dev';
  const resend = await getResendClient();

  for (const entry of entries) {
    const recipient = byId.get(entry.recipientId);
    // The in-app row (written above, unconditionally) already covers this
    // person — the email is a mirror they have opted out of, not the record.
    if (!recipient || !recipient.email_notifications_enabled) continue;

    const { error: sendError } = await resend.emails.send({
      from,
      to: recipient.email,
      subject: entry.title,
      text: entry.body ?? entry.title,
    });

    if (sendError) {
      console.error(
        `[notify:email] failed to send "${entry.title}" to ${recipient.email}: ` +
          sendError.message,
      );
    }
  }
}
