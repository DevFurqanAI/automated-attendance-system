import { SkeletonFilters, SkeletonHeader, SkeletonTable } from '@/components/Skeleton';

export default function Loading() {
  return (
    <div>
      <SkeletonHeader withActions />
      <SkeletonFilters />
      <SkeletonTable rows={6} cols={5} />
    </div>
  );
}
