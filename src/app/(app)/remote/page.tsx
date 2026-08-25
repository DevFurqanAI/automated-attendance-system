import type { Metadata } from 'next';
import { createClient, getSessionUser } from '@/lib/supabase/server';
import type { Attendance } from '@/lib/types';
import { RecentRemoteRequests } from './RecentRemoteRequests';
import { RemoteForm } from './RemoteForm';

export const metadata: Metadata = { title: 'Remote check-in' };

export default async function RemotePage() {
  const user = (await getSessionUser())!;
  const supabase = await createClient();

  const { data: recent } = await supabase
    .from('attendance')
    .select('*')
    .eq('employee_id', user.id)
    .eq('method', 'remote_request')
    .order('submitted_at', { ascending: false })
    .limit(5)
    .returns<Attendance[]>();

  return (
    <div className="mx-auto max-w-xl">
      <h1 className="text-2xl font-bold tracking-tight text-brand-secondary">
        Remote check-in
      </h1>
      <p className="mt-1.5 text-sm text-ink-muted">
        For work done away from a branch. An HR administrator reviews every
        request — it does not count as attendance until it is approved.
      </p>

      <div className="card mt-5 p-5">
        <RemoteForm />
      </div>

      <RecentRemoteRequests initialRows={recent ?? []} />
    </div>
  );
}
