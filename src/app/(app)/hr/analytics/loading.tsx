import { SkeletonCard, SkeletonFilters, SkeletonHeader, SkeletonStatRow } from '@/components/Skeleton';

export default function Loading() {
  return (
    <div>
      <SkeletonHeader />
      <SkeletonFilters />
      <SkeletonStatRow count={3} />
      <div className="mt-5">
        <SkeletonCard lines={6} />
      </div>
    </div>
  );
}
