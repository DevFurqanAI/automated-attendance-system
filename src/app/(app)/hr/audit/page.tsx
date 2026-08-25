import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { AUDIT_ACTION_LABELS, type AuditRow } from '@/lib/audit';
import { formatDateTime } from '@/lib/format';
import { createClient, getHrUser } from '@/lib/supabase/server';

export const metadata: Metadata = { title: 'Audit log' };

/** Renders the `detail` jsonb as something readable without dumping JSON. */
function summarise(row: AuditRow): string | null {
  const d = row.detail ?? {};
  switch (row.action) {
    case 'employee.role_change':
      return `${d.from} → ${d.to}`;
    case 'employee.invite':
      return typeof d.email === 'string' ? d.email : null;
    case 'employee.email_change':
      return `${d.from} → ${d.to}`;
    case 'employee.leave_balance_change':
      return `${d.from} → ${d.to} days`;
    case 'employee.delete':
      return [d.full_name, d.email].filter(Boolean).join(' · ') || null;
    case 'absence.hr_create':
      return typeof d.date === 'string' ? d.date : null;
    case 'leave.hr_mark':
      return typeof d.from_date === 'string' ? `${d.from_date} → ${d.to_date}` : null;
    case 'branch.qr_rotate':
      return `version ${d.from_version} → ${d.to_version}`;
    case 'branch.create':
    case 'branch.update':
      return typeof d.name === 'string' ? d.name : null;
    case 'attendance.approve':
    case 'attendance.decline':
      return [
        d.method === 'remote_request'
          ? 'remote request'
          : d.method === 'hr_manual'
            ? 'HR-marked'
            : 'QR check-in',
        d.flag_reason ? `flagged: ${d.flag_reason}` : null,
      ]
        .filter(Boolean)
        .join(' · ');
    case 'attendance.hr_create':
      return typeof d.check_in_time === 'string' ? formatDateTime(d.check_in_time) : null;
    case 'attendance.hr_edit':
      return typeof d.reason === 'string' ? d.reason : null;
    default:
      return null;
  }
}

export default async function AuditPage() {
  const user = await getHrUser();
  // The layout already gates the app, and RLS gates the table — but a
  // non-admin reaching this URL should get sent somewhere useful rather than
  // an empty table that looks broken.
  if (!user) redirect('/');

  const supabase = await createClient();
  const { data: rows } = await supabase
    .from('audit_log')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(200)
    .returns<AuditRow[]>();

  const entries = rows ?? [];

  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight text-brand-secondary">
        Audit log
      </h1>
      <p className="mt-1.5 text-sm text-ink-muted">
        Every privileged action, newest first. Append-only — entries cannot be
        edited or removed through the app.
      </p>

      {entries.length === 0 ? (
        <div className="card mt-5 p-8 text-center">
          <p className="text-sm text-ink-muted">
            Nothing recorded yet. Approvals, role changes, branch edits and QR
            rotations will appear here.
          </p>
        </div>
      ) : (
        <div className="card mt-5 overflow-x-auto">
          <table className="w-full min-w-[40rem] text-left text-sm">
            <thead className="border-b border-line">
              <tr className="text-xs uppercase tracking-wide text-ink-muted">
                <th className="px-4 py-3 font-bold">When</th>
                <th className="px-4 py-3 font-bold">Who</th>
                <th className="px-4 py-3 font-bold">Action</th>
                <th className="px-4 py-3 font-bold">Details</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((row) => {
                const detail = summarise(row);
                return (
                  <tr key={row.id} className="border-b border-line last:border-0">
                    <td className="whitespace-nowrap px-4 py-3 text-ink-muted">
                      {formatDateTime(row.created_at)}
                    </td>
                    <td className="px-4 py-3">
                      <span className="font-semibold text-ink">
                        {row.actor_name}
                      </span>
                      <span className="block text-xs text-ink-faint">
                        {row.actor_email}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {AUDIT_ACTION_LABELS[row.action] ?? row.action}
                      {row.self_action && (
                        // The reason self-review is allowed at all is that it
                        // stays visible. This is where it stays visible.
                        <span className="ml-2 bg-status-flagged-bg px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-status-flagged">
                          Self
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-ink-muted">{detail ?? '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {entries.length === 200 && (
        <p className="mt-3 text-xs text-ink-faint">
          Showing the most recent 200 entries.
        </p>
      )}
    </div>
  );
}
