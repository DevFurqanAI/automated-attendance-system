import { SkeletonHeader, SkeletonTable, SkeletonTabs } from '@/components/Skeleton';

export default function Loading() {
  return (
    <div>
      <SkeletonHeader />
      <SkeletonTabs count={5} />
      <SkeletonTable rows={6} cols={5} />
    </div>
  );
}
