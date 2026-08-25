import { TZ } from '@/lib/format';

/**
 * Branch check-in time windows — an optional "we're only open 08:00–20:00"
 * restriction per branch. Like everything else added this session that
 * touches whether an arrival looks "off", this is a FLAG on check-in, never
 * a block: the person may have a legitimate reason (an early opening, a
 * genuine emergency), and this system's rule throughout is that attendance
 * is recorded and queued for a human, never silently rejected — see
 * detectSpoofing's own header comment.
 */

/**
 * Whether `checkInTimeIso`, evaluated in Asia/Karachi, falls within
 * [start, end] ("HH:MM[:SS]" strings). Either null means no restriction —
 * always within. Handles a window that crosses midnight (start > end).
 */
export function isWithinCheckinWindow(
  checkInTimeIso: string,
  start: string | null,
  end: string | null,
): boolean {
  if (!start || !end) return true;

  const toMinutes = (t: string) => {
    const [h, m] = t.split(':').map(Number);
    return h * 60 + m;
  };

  const localTime = new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(checkInTimeIso));

  const nowMin = toMinutes(localTime);
  const startMin = toMinutes(start);
  const endMin = toMinutes(end);

  if (startMin <= endMin) {
    return nowMin >= startMin && nowMin <= endMin;
  }
  // Overnight window, e.g. 22:00–06:00.
  return nowMin >= startMin || nowMin <= endMin;
}
