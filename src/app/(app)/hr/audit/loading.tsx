import { SkeletonHeader, SkeletonTable } from '@/components/Skeleton';

export default function Loading() {
  return (
    <div>
      <SkeletonHeader />
      <SkeletonTable rows={10} cols={4} />
    </div>
  );
}
