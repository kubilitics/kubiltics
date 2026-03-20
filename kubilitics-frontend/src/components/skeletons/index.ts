/**
 * Page-specific loading skeletons (TASK-UX-008).
 *
 * Each skeleton mirrors the real page layout to minimise layout shift during load.
 * Built on top of the base `<Skeleton />` from `@/components/ui/skeleton` with
 * staggered Framer Motion reveal animations.
 */
export { DashboardSkeleton } from './DashboardSkeleton';
export type { DashboardSkeletonProps } from './DashboardSkeleton';

export { TopologySkeleton } from './TopologySkeleton';
export type { TopologySkeletonProps } from './TopologySkeleton';

export { ResourceListSkeleton } from './ResourceListSkeleton';
export type { ResourceListSkeletonProps } from './ResourceListSkeleton';

export { ResourceDetailSkeleton } from './ResourceDetailSkeleton';
export type { ResourceDetailSkeletonProps } from './ResourceDetailSkeleton';
