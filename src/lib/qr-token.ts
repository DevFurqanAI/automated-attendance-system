import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Branch QR tokens.
 *
 * DESIGN DECISION (spec §13): tokens are signed with a **per-branch** secret
 * (`branches.qr_secret`), not one app-wide secret.
 *
 * Why per-branch:
 *  - Compromising one printed code (or one branch's secret) does not let an
 *    attacker mint tokens for the other two branches.
 *  - HR can rotate a single branch's code — after a break-in, a reprint, an
 *    office move — without invalidating the others.
 *
 * The QR code is printed and stuck on a wall, so the token cannot carry a
 * short expiry. It is deliberately a long-lived *branch identifier that cannot
 * be forged*, not a proof of presence. Presence is proven by the second
 * factor: the GPS geofence check, which runs on every scan.
 *
 * `qr_version` is embedded and compared on verify, so bumping the column
 * invalidates every code previously printed for that branch.
 *
 * Format:  attn1.<base64url(payload)>.<base64url(hmac-sha256)>
 */

const PREFIX = 'attn1';

interface TokenPayload {
  /** branch id */
  b: string;
  /** qr_version */
  v: number;
}

const b64url = (buf: Buffer) => buf.toString('base64url');

function sign(payloadB64: string, secret: string): string {
  return b64url(createHmac('sha256', secret).update(payloadB64).digest());
}

/** Builds the string that gets rendered into a branch's printed QR code. */
export function createBranchToken(branch: {
  id: string;
  qr_version: number;
  qr_secret: string;
}): string {
  const payload: TokenPayload = { b: branch.id, v: branch.qr_version };
  const payloadB64 = b64url(Buffer.from(JSON.stringify(payload)));
  return `${PREFIX}.${payloadB64}.${sign(payloadB64, branch.qr_secret)}`;
}

/**
 * Reads the branch id out of a scanned token *without* verifying it, so the
 * caller knows which branch's secret to load. The result is untrusted until
 * `verifyBranchToken` succeeds.
 */
export function peekBranchId(token: string): string | null {
  const parts = token.trim().split('.');
  if (parts.length !== 3 || parts[0] !== PREFIX) return null;
  try {
    const payload = JSON.parse(
      Buffer.from(parts[1], 'base64url').toString('utf8'),
    ) as TokenPayload;
    return typeof payload.b === 'string' ? payload.b : null;
  } catch {
    return null;
  }
}

export type VerifyResult =
  | { ok: true; branchId: string; version: number }
  | { ok: false; reason: 'malformed' | 'bad_signature' | 'stale_version' };

/** Constant-time verification against the branch's own secret. */
export function verifyBranchToken(
  token: string,
  branch: { id: string; qr_version: number; qr_secret: string },
): VerifyResult {
  const parts = token.trim().split('.');
  if (parts.length !== 3 || parts[0] !== PREFIX) {
    return { ok: false, reason: 'malformed' };
  }

  const [, payloadB64, providedSig] = parts;

  const expected = Buffer.from(sign(payloadB64, branch.qr_secret));
  const provided = Buffer.from(providedSig);
  if (
    expected.length !== provided.length ||
    !timingSafeEqual(expected, provided)
  ) {
    return { ok: false, reason: 'bad_signature' };
  }

  let payload: TokenPayload;
  try {
    payload = JSON.parse(
      Buffer.from(payloadB64, 'base64url').toString('utf8'),
    ) as TokenPayload;
  } catch {
    return { ok: false, reason: 'malformed' };
  }

  if (payload.b !== branch.id) return { ok: false, reason: 'malformed' };
  // A code printed before the last rotation must stop working.
  if (payload.v !== branch.qr_version) {
    return { ok: false, reason: 'stale_version' };
  }

  return { ok: true, branchId: payload.b, version: payload.v };
}
