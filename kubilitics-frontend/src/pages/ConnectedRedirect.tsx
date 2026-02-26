/**
 * Dedicated route: apply cluster from Connect page and redirect to home (P1-7).
 * Stays outside ProtectedRoute so we always apply state, then go to /home.
 * If location.state is lost (e.g. refresh), uses clusterId from URL and fetches cluster from backend.
 * Runs apply+redirect exactly once (ref guard) to avoid Strict Mode double-run races.
 */
import { useEffect, useRef } from 'react';
import { useNavigate, useLocation, useSearchParams } from 'react-router-dom';
import { useClusterStore } from '@/stores/clusterStore';
import { useBackendConfigStore, getEffectiveBackendBaseUrl } from '@/stores/backendConfigStore';
import type { ConnectState } from '@/types/connect';
import { getClusters } from '@/services/backendApiClient';
import { backendClusterToCluster } from '@/lib/backendClusterAdapter';
import { Loader2 } from 'lucide-react';

function getPostConnectPath(returnUrl: string | null): string {
  if (!returnUrl || !returnUrl.startsWith('/') || returnUrl.startsWith('//')) return '/home';
  if (returnUrl === '/' || returnUrl === '/connect' || returnUrl.startsWith('/connect?') || returnUrl === '/mode-selection') return '/home';
  return returnUrl;
}

export default function ConnectedRedirect() {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const clusterIdFromUrl = searchParams.get('clusterId');
  const returnUrl = searchParams.get('returnUrl');
  const postConnectPath = getPostConnectPath(returnUrl);
  const backendBaseUrl = useBackendConfigStore((s) => s.backendBaseUrl);
  const { setActiveCluster, setClusters, setDemo } = useClusterStore();
  const setCurrentClusterId = useBackendConfigStore((s) => s.setCurrentClusterId);
  const didRun = useRef(false);

  useEffect(() => {
    if (didRun.current) return;
    const state = location.state as ConnectState | null;
    if (state?.connectedCluster && state?.clusterId) {
      didRun.current = true;
      setCurrentClusterId(state.clusterId);
      setClusters(state.connectedClusters);
      setActiveCluster(state.connectedCluster);
      setDemo(false);
      navigate(postConnectPath, { replace: true });
      return;
    }
    if (clusterIdFromUrl) {
      const baseUrl = getEffectiveBackendBaseUrl(backendBaseUrl);
      if (!baseUrl) {
        didRun.current = true;
        navigate('/', { replace: true });
        return;
      }
      didRun.current = true;
      getClusters(baseUrl)
        .then((list) => {
          const backendCluster = list.find((c) => c.id === clusterIdFromUrl);
          if (!backendCluster) {
            navigate('/', { replace: true });
            return;
          }
          const connectedCluster = backendClusterToCluster(backendCluster);
          const connectedClusters = list.map(backendClusterToCluster);
          setCurrentClusterId(clusterIdFromUrl);
          setClusters(connectedClusters);
          setActiveCluster(connectedCluster);
          setDemo(false);
          navigate(postConnectPath, { replace: true });
        })
        .catch(() => {
          navigate('/', { replace: true });
        });
      return;
    }
    didRun.current = true;
    navigate('/', { replace: true });
  }, [
    location.state,
    clusterIdFromUrl,
    postConnectPath,
    backendBaseUrl,
    navigate,
    setCurrentClusterId,
    setClusters,
    setActiveCluster,
    setDemo,
  ]);

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-background gap-3">
      <Loader2 className="h-8 w-8 animate-spin text-primary" />
      <p className="text-muted-foreground">Connecting…</p>
    </div>
  );
}
