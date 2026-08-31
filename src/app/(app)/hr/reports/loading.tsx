import { SkeletonCard, SkeletonFilters, SkeletonHeader } from '@/components/Skeleton';

export default function Loading() {
  return (
    <div>
      <SkeletonHeader />
      <SkeletonFilters />
      <div className="mt-5">
        <SkeletonCard lines={5} />
      </div>
    </div>
  );
}
