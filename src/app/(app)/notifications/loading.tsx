import { SkeletonHeader, SkeletonList } from '@/components/Skeleton';

export default function Loading() {
  return (
    <div className="mx-auto max-w-2xl">
      <SkeletonHeader />
      <SkeletonList rows={6} />
    </div>
  );
}
