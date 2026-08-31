import { SkeletonCard } from '@/components/Skeleton';

export default function Loading() {
  return (
    <div className="mx-auto max-w-xl">
      <SkeletonCard lines={5} />
    </div>
  );
}
