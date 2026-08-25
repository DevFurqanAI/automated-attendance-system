import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { SessionUser } from '@/lib/supabase/server';

/**
 * Append-only audit trail — see supabase/migrations/20260824092000_audit_log.sql.
 *
 * Every privileged action goes through here: approvals, role changes,
 * deactivations, branch edits, QR rotations.
 */

export type AuditAction =
  | 'attendance.approve'
  | 'attendance.decline'
  | 'attendance.force_checkout'
  | 'attendance.hr_create'
  | 'attendance.hr_edit'
  | 'leave.approve'
  | 'leave.decline'
  | 'absence.reversed'
  | 'absence.hr_create'
  | 'leave.hr_mark'
  | 'employee.invite'
  | 'employee.role_change'
  | 'employee.activate'
  | 'employee.deactivate'
  | 'employee.branch_change'
  | 'employee.weekly_off_days_change'
  | 'employee.email_change'
  | 'employee.delete'
  | 'branch.create'
  | 'branch.update'
  | 'branch.qr_rotate'
  | 'hr.branches_assigned';

export interface AuditEntry {
  action: AuditAction;
  entityType: 'attendance' | 'employee' | 'branch' | 'leave_request';
  entityId?: string | null;
  /** The employee this action was *about*, when that differs from the entity. */
  subjectId?: string | null;
  detail?: Record<string, unknown>;
}

/**
 * Records one action. Takes the already-resolved HR user rather than looking it
 * up, so the row names whoever actually passed the authorization check.
 *
 * Deliberately never throws. An audit write failing must not roll back or
 * fail the action the user asked for — a declined leave request that silently
 * became an error would be worse than a gap in the log. Failures are logged to
 * the server console, where Vercel keeps them.
 */
export async function recordAudit(
  admin: SupabaseClient,
  actor: SessionUser,
  entry: AuditEntry,
): Promise<void> {
  const { error } = await admin.from('audit_log').insert({
    actor_id: actor.id,
    actor_name: actor.employee.full_name,
    actor_email: actor.email,
    action: entry.action,
    entity_type: entry.entityType,
    entity_id: entry.entityId ?? null,
    subject_id: entry.subjectId ?? null,
    self_action: Boolean(entry.subjectId) && entry.subjectId === actor.id,
    detail: entry.detail ?? {},
  });

  if (error) {
    console.error(`[audit] failed to record ${entry.action}: ${error.message}`);
  }
}

/** Human-readable labels for the audit page. */
export const AUDIT_ACTION_LABELS: Record<AuditAction, string> = {
  'attendance.approve': 'Approved attendance',
  'attendance.decline': 'Declined attendance',
  'attendance.force_checkout': 'Force-closed an open shift',
  'attendance.hr_create': 'Marked an employee present',
  'attendance.hr_edit': 'Edited an attendance record',
  'leave.approve': 'Approved leave request',
  'leave.decline': 'Declined leave request',
  'absence.reversed': 'Reversed a marked absence',
  'absence.hr_create': 'Marked an employee absent',
  'leave.hr_mark': 'Recorded leave directly',
  'employee.invite': 'Invited employee',
  'employee.role_change': 'Changed role',
  'employee.activate': 'Reactivated employee',
  'employee.deactivate': 'Deactivated employee',
  'employee.branch_change': 'Changed default branch',
  'employee.weekly_off_days_change': 'Changed weekly off days',
  'employee.email_change': 'Changed work email',
  'employee.delete': 'Deleted employee',
  'branch.create': 'Created branch',
  'branch.update': 'Updated branch',
  'branch.qr_rotate': 'Rotated QR code',
  'hr.branches_assigned': 'Updated HR branch assignments',
};

export interface AuditRow {
  id: string;
  actor_id: string | null;
  actor_name: string;
  actor_email: string;
  action: AuditAction;
  entity_type: 'attendance' | 'employee' | 'branch' | 'leave_request';
  entity_id: string | null;
  subject_id: string | null;
  self_action: boolean;
  detail: Record<string, unknown>;
  created_at: string;
}
