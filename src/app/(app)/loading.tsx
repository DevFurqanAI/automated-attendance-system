import { SkeletonCard, SkeletonHeader } from '@/components/Skeleton';

export default function Loading() {
  return (
    <div className="mx-auto max-w-3xl">
      <SkeletonHeader />
      <div className="mt-5">
        <SkeletonCard lines={3} />
      </div>
    </div>
  );
}
