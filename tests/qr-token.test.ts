import { describe, expect, it } from 'vitest';
import {
  createBranchToken,
  peekBranchId,
  verifyBranchToken,
} from '@/lib/qr-token';

const branch = {
  id: '11111111-1111-1111-1111-111111111111',
  qr_version: 1,
  qr_secret: 'a'.repeat(64),
};

const otherBranch = {
  id: '22222222-2222-2222-2222-222222222222',
  qr_version: 1,
  qr_secret: 'b'.repeat(64),
};

describe('branch QR tokens', () => {
  it('verifies a token it just issued', () => {
    const token = createBranchToken(branch);
    const result = verifyBranchToken(token, branch);

    expect(result).toEqual({ ok: true, branchId: branch.id, version: 1 });
  });

  it('exposes the branch id before verification so the secret can be looked up', () => {
    expect(peekBranchId(createBranchToken(branch))).toBe(branch.id);
  });

  it('rejects a token signed with a different branch secret', () => {
    // The attack this prevents: photographing branch A's code and replaying it
    // as branch B, or minting a code for a branch you never visited.
    const forged = createBranchToken({ ...otherBranch, id: branch.id });
    const result = verifyBranchToken(forged, branch);

    expect(result).toEqual({ ok: false, reason: 'bad_signature' });
  });

  it('rejects a tampered payload', () => {
    const token = createBranchToken(branch);
    const [prefix, , signature] = token.split('.');
    const swappedPayload = Buffer.from(
      JSON.stringify({ b: otherBranch.id, v: 1 }),
    ).toString('base64url');

    const result = verifyBranchToken(
      `${prefix}.${swappedPayload}.${signature}`,
      branch,
    );

    expect(result).toEqual({ ok: false, reason: 'bad_signature' });
  });

  it('rejects a code printed before the branch rotated its secret', () => {
    const oldToken = createBranchToken(branch);
    const rotated = { ...branch, qr_version: 2 };

    // Same secret, bumped version — the version guard alone must reject it.
    expect(verifyBranchToken(oldToken, rotated)).toEqual({
      ok: false,
      reason: 'stale_version',
    });
  });

  it.each([
    ['empty', ''],
    ['not a token', 'https://example.com'],
    ['wrong prefix', 'attn0.abc.def'],
    ['too few parts', 'attn1.abc'],
  ])('rejects a malformed token (%s)', (_label, token) => {
    expect(verifyBranchToken(token, branch).ok).toBe(false);
    expect(peekBranchId(token)).toBeNull();
  });
});
