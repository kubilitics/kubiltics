/**
 * ProductionBanner — 3px red gradient bar at the very top of the page when the
 * active cluster is tagged as "production". Universal safety pattern (AWS, GCP, etc).
 * Week 7: Cluster Colors & Environment Badges
 */
import { useState, useEffect } from 'react';
import { useClusterStore, getClusterAppearance } from '@/stores/clusterStore';

export function ProductionBanner() {
  const activeCluster = useClusterStore((s) => s.activeCluster);
  const [isProduction, setIsProduction] = useState(false);

  useEffect(() => {
    const check = () => {
      const appearance = getClusterAppearance(activeCluster?.id);
      setIsProduction(appearance.environment === 'production');
    };
    check();
    // Listen for appearance changes from the settings panel
    window.addEventListener('cluster-appearance-changed', check);
    return () => window.removeEventListener('cluster-appearance-changed', check);
  }, [activeCluster?.id]);

  if (!isProduction) return null;

  return (
    <div
      className="h-[3px] bg-gradient-to-r from-red-500 via-red-600 to-red-500 shrink-0"
      role="status"
      aria-label="Production environment"
    />
  );
}
