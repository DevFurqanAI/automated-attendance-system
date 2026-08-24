/** Presentation helpers shared by the staff and HR views. */

// All branches are in Pakistan, and pages render on the server where the
// process timezone is not the viewer's — pin it explicitly, or a server
// running in UTC would show every time shifted by 5 hours.
const TZ = 'Asia/Karachi';

const DATE_TIME = new Intl.DateTimeFormat('en-GB', {
  timeZone: TZ,
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

const TIME = new Intl.DateTimeFormat('en-GB', {
  timeZone: TZ,
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

const DATE = new Intl.DateTimeFormat('en-GB', {
  timeZone: TZ,
  day: '2-digit',
  month: 'short',
  year: 'numeric',
});

export function formatDateTime(value: string | Date | null): string {
  if (!value) return '—';
  return DATE_TIME.format(new Date(value));
}

export function formatTime(value: string | Date | null): string {
  if (!value) return '—';
  return TIME.format(new Date(value));
}

export function formatDate(value: string | Date | null): string {
  if (!value) return '—';
  return DATE.format(new Date(value));
}

/** Decimal hours between two timestamps, or null when the shift is open. */
export function hoursWorked(
  checkIn: string | null,
  checkOut: string | null,
): number | null {
  if (!checkIn || !checkOut) return null;
  const ms = new Date(checkOut).getTime() - new Date(checkIn).getTime();
  if (!Number.isFinite(ms) || ms < 0) return null;
  return ms / 3_600_000;
}

/** "7h 45m" — easier to scan in a table than "7.75". */
export function formatDuration(hours: number | null): string {
  if (hours == null) return '—';
  const totalMinutes = Math.round(hours * 60);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h === 0) return `${m}m`;
  return `${h}h ${m.toString().padStart(2, '0')}m`;
}

/**
 * `datetime-local` inputs speak local wall-clock time with no zone, so we
 * convert explicitly rather than slicing an ISO string (which would silently
 * shift the value by the UTC offset).
 */
export function toLocalInputValue(date: Date): string {
  const pad = (n: number) => n.toString().padStart(2, '0');
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}
