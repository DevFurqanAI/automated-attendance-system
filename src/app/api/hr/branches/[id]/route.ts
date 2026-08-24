import { NextResponse } from 'next/server';
import { randomBytes } from 'node:crypto';
import { recordAudit } from '@/lib/audit';
import { isBranchManagedBy } from '@/lib/hr-scope';
import { createAdminClient, getHrUser } from '@/lib/supabase/server';
import { parseBranchInput } from '../route';

/**
 * PATCH /api/hr/branches/:id — update a branch, or rotate its QR secret.
 *
 * Send `{ rotate: true }` to issue a fresh secret and bump qr_version. Every
 * previously printed code for that branch stops verifying immediately, so this
 * is the "someone photographed our QR code" button.
 */
export async function PATCH(
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

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Malformed request.' }, { status: 400 });
  }

  const admin = createAdminClient();

  if (!(await isBranchManagedBy(admin, hr, id))) {
    return NextResponse.json(
      { error: 'This branch is not assigned to you.' },
      { status: 403 },
    );
  }

  if (body.rotate === true) {
    const { data: current } = await admin
      .from('branches')
      .select('qr_version')
      .eq('id', id)
      .single<{ qr_version: number }>();

    if (!current) {
      return NextResponse.json({ error: 'Branch not found.' }, { status: 404 });
    }

    const { error } = await admin
      .from('branches')
      .update({
        qr_secret: randomBytes(32).toString('hex'),
        qr_version: current.qr_version + 1,
      })
      .eq('id', id);

    if (error) {
      return NextResponse.json(
        { error: 'Could not rotate the QR secret.' },
        { status: 500 },
      );
    }

    // Worth an audit line of its own: rotating invalidates every printed code
    // at that branch, so staff arriving to a dead QR need a reason to point at.
    await recordAudit(admin, hr, {
      action: 'branch.qr_rotate',
      entityType: 'branch',
      entityId: id,
      detail: { from_version: current.qr_version, to_version: current.qr_version + 1 },
    });

    return NextResponse.json({
      id,
      rotated: true,
      qr_version: current.qr_version + 1,
    });
  }

  const parsed = parseBranchInput(body);
  if ('error' in parsed) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const { error } = await admin
    .from('branches')
    .update(parsed.value)
    .eq('id', id);

  if (error) {
    return NextResponse.json(
      { error: 'Could not update the branch.' },
      { status: 500 },
    );
  }

  await recordAudit(admin, hr, {
    action: 'branch.update',
    entityType: 'branch',
    entityId: id,
    detail: parsed.value,
  });

  return NextResponse.json({ id, ...parsed.value });
}
