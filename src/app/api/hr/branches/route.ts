import { NextResponse } from 'next/server';
import { recordAudit } from '@/lib/audit';
import { createAdminClient, getSuperAdminUser } from '@/lib/supabase/server';

/** POST /api/hr/branches — create a branch. Super-admin only (see RLS). */
export async function POST(request: Request) {
  const hr = await getSuperAdminUser();
  if (!hr) {
    return NextResponse.json(
      { error: 'Super administrator access required.' },
      { status: 403 },
    );
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Malformed request.' }, { status: 400 });
  }

  const parsed = parseBranchInput(body);
  if ('error' in parsed) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from('branches')
    // qr_secret and qr_version come from their column defaults, so a new
    // branch is immediately printable without any extra step.
    .insert(parsed.value)
    .select('id, name')
    .single();

  if (error) {
    return NextResponse.json(
      { error: 'Could not create the branch.' },
      { status: 500 },
    );
  }

  await recordAudit(admin, hr, {
    action: 'branch.create',
    entityType: 'branch',
    entityId: data.id,
    detail: parsed.value,
  });

  return NextResponse.json(data);
}

export function parseBranchInput(body: Record<string, unknown>):
  | {
      value: {
        name: string;
        latitude: number;
        longitude: number;
        radius_meters: number;
        weekly_off_days?: number[];
      };
    }
  | { error: string } {
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const latitude = Number(body.latitude);
  const longitude = Number(body.longitude);
  const radius = Number(body.radius_meters ?? body.radiusMeters);

  if (!name) return { error: 'Branch name is required.' };
  if (!Number.isFinite(latitude) || Math.abs(latitude) > 90) {
    return { error: 'Latitude must be between -90 and 90.' };
  }
  if (!Number.isFinite(longitude) || Math.abs(longitude) > 180) {
    return { error: 'Longitude must be between -180 and 180.' };
  }
  if (!Number.isFinite(radius) || radius <= 0 || radius > 5000) {
    return { error: 'Geofence radius must be between 1 and 5000 metres.' };
  }

  let weeklyOffDays: number[] | undefined;
  if (body.weeklyOffDays !== undefined) {
    if (
      !Array.isArray(body.weeklyOffDays) ||
      !body.weeklyOffDays.every((d) => Number.isInteger(d) && d >= 0 && d <= 6)
    ) {
      return { error: 'weeklyOffDays must be an array of integers between 0 and 6.' };
    }
    weeklyOffDays = body.weeklyOffDays;
  }

  return {
    value: {
      name,
      latitude,
      longitude,
      radius_meters: Math.round(radius),
      ...(weeklyOffDays !== undefined ? { weekly_off_days: weeklyOffDays } : {}),
    },
  };
}
