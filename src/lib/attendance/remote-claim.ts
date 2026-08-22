import { REMOTE_CLAIM_MAX_AGE_DAYS } from '@/lib/types';

/**
 * Validation for a remote check-in claim (spec §7.4.3).
 *
 * Extracted as a pure function so the rule that actually gates attendance can
 * be unit-tested directly, independently of HTTP plumbing. The API route is the
 * only enforcement point that matters — the form's `min`/`max` attributes are
 * a convenience and are assumed to be bypassable.
 */

/** Tolerance so a request submitted "now" is not rejected by clock skew. */
export const FUTURE_TOLERANCE_MS = 5 * 60 * 1000;

export type ClaimValidation =
  | { ok: true; checkIn: Date; checkOut: Date | null }
  | { ok: false; error: string };

export function validateRemoteClaim(
  claimedCheckIn: Date | null,
  claimedCheckOut: Date | null,
  now: Date = new Date(),
): ClaimValidation {
  if (!claimedCheckIn || Number.isNaN(claimedCheckIn.getTime())) {
    return { ok: false, error: 'A valid claimed check-in time is required.' };
  }

  const earliest = new Date(now);
  earliest.setDate(earliest.getDate() - REMOTE_CLAIM_MAX_AGE_DAYS);

  if (claimedCheckIn.getTime() < earliest.getTime()) {
    return {
      ok: false,
      error:
        `Claimed work time cannot be more than ${REMOTE_CLAIM_MAX_AGE_DAYS} days ` +
        `before today. Ask HR to record anything older.`,
    };
  }

  if (claimedCheckIn.getTime() > now.getTime() + FUTURE_TOLERANCE_MS) {
    return { ok: false, error: 'Claimed work time cannot be in the future.' };
  }

  if (claimedCheckOut) {
    if (Number.isNaN(claimedCheckOut.getTime())) {
      return { ok: false, error: 'The claimed check-out time is not a valid date.' };
    }
    if (claimedCheckOut.getTime() < claimedCheckIn.getTime()) {
      return {
        ok: false,
        error: 'Claimed check-out cannot be before claimed check-in.',
      };
    }
    if (claimedCheckOut.getTime() > now.getTime() + FUTURE_TOLERANCE_MS) {
      return { ok: false, error: 'Claimed check-out cannot be in the future.' };
    }
  }

  return { ok: true, checkIn: claimedCheckIn, checkOut: claimedCheckOut };
}
