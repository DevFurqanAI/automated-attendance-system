import type { Metadata } from 'next';
import { formatDateTime } from '@/lib/format';
import type { NotificationRow } from '@/lib/notify';
import { createClient, getSessionUser } from '@/lib/supabase/server';
import { MarkRead } from './MarkRead';

export const metadata: Metadata = { title: 'Notifications' };

/** Colour and glyph per kind — flags and declines should read differently. */
const STYLE: Record<NotificationRow['kind'], { icon: string; tone: string }> = {
  attendance_approved: { icon: '✓', tone: 'text-status-approved' },
  attendance_declined: { icon: '✕', tone: 'text-status-declined' },
  attendance_flagged: { icon: '⚑', tone: 'text-status-flagged' },
  remote_submitted: { icon: '⌂', tone: 'text-ink-muted' },
  review_needed: { icon: '⚑', tone: 'text-status-flagged' },
  role_changed: { icon: '★', tone: 'text-brand-primary' },
  account_deactivated: { icon: '✕', tone: 'text-status-declined' },
};

export default async function NotificationsPage() {
  const user = (await getSessionUser())!;
  const supabase = await createClient();

  // RLS scopes this to the caller ("notifications read own"), so no filter on
  // recipient_id is needed — but the ordering matters: unread first, then
  // newest, so the thing you came for is at the top.
  const { data: rows } = await supabase
    .from('notifications')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(100)
    .returns<NotificationRow[]>();

  const notifications = rows ?? [];
  const unreadIds = notifications.filter((n) => !n.read_at).map((n) => n.id);

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-2xl font-bold tracking-tight text-brand-secondary">
        Notifications
      </h1>
      <p className="mt-1.5 text-sm text-ink-muted">
        {unreadIds.length > 0
          ? `${unreadIds.length} unread.`
          : 'Everything here has been read.'}
      </p>

      {/* Marks them read once they have actually been on screen. */}
      <MarkRead ids={unreadIds} />

      {notifications.length === 0 ? (
        <div className="card mt-5 p-8 text-center">
          <p className="text-sm text-ink-muted">
            Nothing yet. Approvals, declines and flagged check-ins show up here.
          </p>
        </div>
      ) : (
        <ul className="mt-5 space-y-2">
          {notifications.map((n) => {
            const style = STYLE[n.kind];
            return (
              <li
                key={n.id}
                className={`card p-4 ${n.read_at ? '' : 'border-l-4 border-brand-primary'}`}
              >
                <div className="flex items-start gap-3">
                  <span aria-hidden className={`text-lg leading-6 ${style.tone}`}>
                    {style.icon}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-ink">{n.title}</p>
                    {n.body && (
                      <p className="mt-1 text-sm text-ink-muted">{n.body}</p>
                    )}
                    <p className="mt-1.5 text-xs text-ink-faint">
                      {formatDateTime(n.created_at)}
                      {!n.read_at && (
                        <span className="ml-2 font-semibold text-brand-primary">
                          New
                        </span>
                      )}
                    </p>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <p className="mt-6 text-center text-xs text-ink-faint">
        Signed in as {user.employee.full_name}. Only you can see these.
      </p>
    </div>
  );
}
