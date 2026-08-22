import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { createClient, getHrUser } from '@/lib/supabase/server';
import type { Branch } from '@/lib/types';
import { BranchManager } from './BranchManager';

export const metadata: Metadata = { title: 'Branches' };

export default async function BranchesPage() {
  const hr = await getHrUser();
  if (!hr) redirect('/');

  const supabase = await createClient();
  const { data } = await supabase
    .from('branches_public')
    .select('*')
    .order('name')
    .returns<Branch[]>();

  return <BranchManager initialBranches={data ?? []} />;
}
