import type { Status } from '@/lib/types';

/**
 * Status colours come from the `status-*` theme tokens, kept separate from the
 * brand palette so a colour never means two things (spec §12).
 */
const STYLES: Record<Status, string> = {
  approved: 'bg-status-approved-bg text-status-approved',
  pending: 'bg-status-pending-bg text-status-pending',
  flagged: 'bg-status-flagged-bg text-status-flagged',
  declined: 'bg-status-declined-bg text-status-declined',
  // Neutral, same as declined — withdrawn is a self-resolved outcome, not an error.
  withdrawn: 'bg-status-declined-bg text-status-declined',
};

const LABELS: Record<Status, string> = {
  approved: 'Approved',
  pending: 'Pending',
  flagged: 'Flagged',
  declined: 'Declined',
  withdrawn: 'Withdrawn',
};

export function StatusBadge({ status }: { status: Status }) {
  return <span className={`badge ${STYLES[status]}`}>{LABELS[status]}</span>;
}
