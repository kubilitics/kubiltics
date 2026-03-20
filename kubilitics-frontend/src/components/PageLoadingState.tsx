import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface PageLoadingStateProps {
    message?: string;
    className?: string;
    fullScreen?: boolean;
    /** Show skeleton cards instead of just a spinner */
    skeleton?: boolean;
}

function SkeletonBlock({ className }: { className?: string }) {
    return (
        <div
            className={cn(
                'rounded-xl bg-muted/60 animate-pulse',
                className
            )}
        />
    );
}

export function PageLoadingState({
    message = 'Loading...',
    className = '',
    fullScreen = true,
    skeleton = true,
}: PageLoadingStateProps) {
    if (skeleton) {
        return (
            <div
                className={cn('flex flex-col gap-6 p-6', className)}
                role="status"
                aria-busy="true"
                aria-label={message}
            >
                {/* Header skeleton */}
                <div className="flex items-center justify-between">
                    <div className="space-y-2">
                        <SkeletonBlock className="h-7 w-48" />
                        <SkeletonBlock className="h-4 w-72" />
                    </div>
                    <SkeletonBlock className="h-9 w-24 rounded-lg" />
                </div>

                {/* Hero card skeleton */}
                <SkeletonBlock className="h-64 w-full rounded-2xl" />

                {/* Two-column card skeleton */}
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                    <SkeletonBlock className="lg:col-span-8 h-48 rounded-2xl" />
                    <SkeletonBlock className="lg:col-span-4 h-48 rounded-2xl" />
                </div>

                {/* Table skeleton */}
                <div className="rounded-2xl border border-border overflow-hidden">
                    <div className="p-6 border-b border-border">
                        <div className="flex items-center justify-between">
                            <SkeletonBlock className="h-5 w-40" />
                            <SkeletonBlock className="h-10 w-64 rounded-xl" />
                        </div>
                    </div>
                    <div className="divide-y divide-border">
                        {Array.from({ length: 5 }).map((_, i) => (
                            <div key={i} className="flex items-center gap-4 px-6 py-4">
                                <SkeletonBlock className="h-4 w-4 rounded" />
                                <SkeletonBlock className="h-8 w-8 rounded-lg" />
                                <SkeletonBlock className="h-4 flex-1 max-w-[200px]" />
                                <SkeletonBlock className="h-4 w-20" />
                                <SkeletonBlock className="h-5 w-16 rounded-full" />
                                <SkeletonBlock className="h-4 w-12 ml-auto" />
                            </div>
                        ))}
                    </div>
                </div>

                {/* Screen-reader text */}
                <span className="sr-only">{message}</span>
            </div>
        );
    }

    const containerClasses = fullScreen
        ? 'min-h-[60vh] flex items-center justify-center'
        : 'py-12 flex items-center justify-center';

    return (
        <div className={`${containerClasses} ${className}`} role="status" aria-busy="true">
            <div className="text-center space-y-3">
                <Loader2 className="h-10 w-10 animate-spin text-primary mx-auto opacity-80" />
                <p className="text-muted-foreground text-sm font-medium animate-pulse">
                    {message}
                </p>
            </div>
        </div>
    );
}
