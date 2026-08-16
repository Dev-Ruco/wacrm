import { cn } from '@/lib/utils';

/** Shared skeleton primitive used by dashboard widgets while data loads. */
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-md bg-muted', className)} />;
}

/** Skeleton for one cell inside the shared KPI strip. */
export function SkeletonCard({ className }: { className?: string }) {
  return (
    <div className={cn('bg-card px-4 py-4 sm:px-5', className)}>
      <Skeleton className="h-3 w-28" />
      <Skeleton className="mt-3 h-7 w-20" />
      <Skeleton className="mt-2 h-3 w-24" />
    </div>
  );
}
