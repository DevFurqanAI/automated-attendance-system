import { NextResponse } from 'next/server';
import QRCode from 'qrcode';
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
  const { data: branch } = await admin
    .from('branches')
    .select('*')
    .eq('id', id)
    .single<BranchWithSecret>();

  if (!branch) {
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
