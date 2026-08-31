import { SkeletonCard, SkeletonHeader, SkeletonList } from '@/components/Skeleton';

export default function Loading() {
  return (
    <div className="mx-auto max-w-xl">
      <SkeletonHeader />
      <div className="mt-5">
        <SkeletonCard lines={3} />
      </div>
      <SkeletonList rows={3} />
    </div>
  );
}
