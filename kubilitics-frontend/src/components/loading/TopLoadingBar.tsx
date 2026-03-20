import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';

export interface TopLoadingBarProps {
  /** Whether loading is active */
  isLoading: boolean;
  /** Bar color — defaults to primary */
  className?: string;
}

/**
 * YouTube/GitHub-style thin progress bar at the top of the content area.
 * Uses an indeterminate animation that slides back and forth while loading,
 * then fills to 100% and fades out when complete.
 *
 * Mount this inside the list page layout, positioned at the top of the content card.
 */
export function TopLoadingBar({ isLoading, className }: TopLoadingBarProps) {
  const [phase, setPhase] = useState<'idle' | 'loading' | 'finishing' | 'done'>('idle');

  useEffect(() => {
    if (isLoading) {
      setPhase('loading');
    } else if (phase === 'loading') {
      // Loading just ended — show completion animation
      setPhase('finishing');
      const timer = setTimeout(() => setPhase('done'), 400);
      return () => clearTimeout(timer);
    }
  }, [isLoading]);

  // Reset after done animation
  useEffect(() => {
    if (phase === 'done') {
      const timer = setTimeout(() => setPhase('idle'), 300);
      return () => clearTimeout(timer);
    }
  }, [phase]);

  if (phase === 'idle') return null;

  return (
    <div
      className={cn(
        'absolute top-0 left-0 right-0 h-[2.5px] z-50 overflow-hidden rounded-t-xl',
        phase === 'done' && 'opacity-0 transition-opacity duration-300',
        className,
      )}
      role="progressbar"
      aria-label="Loading resources"
    >
      <div
        className={cn(
          'h-full bg-primary',
          phase === 'loading' && 'animate-topbar-indeterminate',
          phase === 'finishing' && 'w-full transition-all duration-300',
        )}
      />
    </div>
  );
}
