import type { Metadata } from 'next';
import { createClient, getSessionUser } from '@/lib/supabase/server';
import { CheckInClient } from './CheckInClient';

export const metadata: Metadata = { title: 'Check in' };

export default async function CheckInPage() {
  const user = await getSessionUser();
  const supabase = await createClient();

  // The employee's open shift, if any, decides whether this screen offers
  // "check in" or "check out".
  const { data: openRows } = await supabase
    .from('attendance')
    .select('id, check_in_time, status, branches:branch_id ( name )')
    .eq('employee_id', user!.id)
    .eq('method', 'qr_gps')
    .in('status', ['approved', 'flagged'])
    .is('check_out_time', null)
    .order('check_in_time', { ascending: false, nullsFirst: false })
    .limit(1);

  const open = openRows?.[0];

  return (
    <CheckInClient
      openShift={
        open
          ? {
              id: open.id as string,
              checkInTime: open.check_in_time as string,
              branchName:
                (open.branches as unknown as { name: string } | null)?.name ??
                'Unknown branch',
            }
          : null
      }
    />
  );
}
