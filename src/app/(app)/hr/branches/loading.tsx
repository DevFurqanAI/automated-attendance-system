import { SkeletonCardGrid, SkeletonHeader } from '@/components/Skeleton';

export default function Loading() {
  return (
    <div>
      <SkeletonHeader withActions />
      <SkeletonCardGrid count={4} />
    </div>
  );
}
