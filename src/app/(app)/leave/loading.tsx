import { SkeletonCard, SkeletonHeader, SkeletonList } from '@/components/Skeleton';

export default function Loading() {
  return (
    <div className="mx-auto max-w-xl">
      <SkeletonHeader />
      <div className="mt-4">
        <SkeletonCard lines={2} />
      </div>
      <SkeletonList rows={3} />
    </div>
  );
}
