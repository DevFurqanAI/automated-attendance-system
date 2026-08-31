import { SkeletonHeader, SkeletonTable } from '@/components/Skeleton';

export default function Loading() {
  return (
    <div>
      <SkeletonHeader />
      <SkeletonTable rows={8} cols={5} />
    </div>
  );
}
