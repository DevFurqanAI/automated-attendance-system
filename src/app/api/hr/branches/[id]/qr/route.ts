import { NextResponse } from 'next/server';
import QRCode from 'qrcode';
import { isBranchManagedBy } from '@/lib/hr-scope';
import { createBranchToken } from '@/lib/qr-token';
import { createAdminClient, getHrUser } from '@/lib/supabase/server';
import type { BranchWithSecret } from '@/lib/types';

/**
 * GET /api/hr/branches/:id/qr — renders the branch's signed token as a QR image
 * for printing and mounting at the entrance.
 *
 * HR-only: the rendered code IS the credential, so this must never be
 * fetchable by staff (who could otherwise photograph a branch code they are
 * not standing in front of). The GPS geofence would still catch the resulting
 * check-in, but there is no reason to hand out the first factor.
 *
 * Also scoped like every other branch-write route (see src/lib/hr-scope.ts):
 * this reads through the service role, which bypasses the RLS policy that
 * would otherwise confine a non-super_admin hr_admin to their assigned
 * branches — without the check below they could mint a valid, printable QR
 * for a branch never assigned to them.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const hr = await getHrUser();
  if (!hr) {
    return NextResponse.json(
      { error: 'HR administrator access required.' },
      { status: 403 },
    );
  }

  const { id } = await params;
  const format = new URL(request.url).searchParams.get('format') ?? 'png';

  const admin = createAdminClient();

  if (!(await isBranchManagedBy(admin, hr, id))) {
    return NextResponse.json(
      { error: 'This branch is not assigned to you.' },
      { status: 403 },
    );
  }

  const { data: branch, error: lookupError } = await admin
    .from('branches')
    .select('*')
    .eq('id', id)
    .single<BranchWithSecret>();

  if (!branch) {
    // Same ambiguity as the PATCH route: this shape is identical whether the
    // branch genuinely doesn't exist or the admin client itself is failing
    // (wrong/expired SUPABASE_SERVICE_ROLE_KEY) — log the real reason.
    if (lookupError) {
      console.error(`[branches/qr] admin lookup failed for ${id}: ${lookupError.message}`);
    }
    return NextResponse.json({ error: 'Branch not found.' }, { status: 404 });
  }

  const token = createBranchToken(branch);

  const options = {
    errorCorrectionLevel: 'H' as const, // survives a scuffed print on a wall
    margin: 2,
    width: 1024,
    color: { dark: '#0b0e10', light: '#ffffff' },
  };

  // Never cache: a rotation must take effect immediately.
  const headers = {
    'Cache-Control': 'private, no-store',
  };

  if (format === 'svg') {
    const svg = await QRCode.toString(token, { ...options, type: 'svg' });
    return new NextResponse(svg, {
      headers: { ...headers, 'Content-Type': 'image/svg+xml' },
    });
  }

  const dataUrl = await QRCode.toDataURL(token, options);
  const png = Buffer.from(dataUrl.split(',')[1], 'base64');

  return new NextResponse(new Uint8Array(png), {
    headers: {
      ...headers,
      'Content-Type': 'image/png',
      'Content-Disposition': `inline; filename="${slug(branch.name)}-qr.png"`,
    },
  });
}

function slug(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'branch'
  );
}
