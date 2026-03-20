/**
 * CacheConfiguration — ENT-008
 *
 * Settings page for cache provider selection (Memory vs Redis).
 * Redis connection configuration form and health check status display.
 */

import { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import {
  Database,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Loader2,
  Save,
  RefreshCw,
  Cpu,
  Server,
} from 'lucide-react';
import { toast } from 'sonner';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { cn } from '@/lib/utils';
import { useBackendConfigStore } from '@/stores/backendConfigStore';

// ─── Types ───────────────────────────────────────────────────

type CacheProvider = 'memory' | 'redis';

interface CacheConfig {
  provider: CacheProvider;
  redis?: {
    host: string;
    port: number;
    password: string;
    db: number;
    tls: boolean;
    maxRetries: number;
    poolSize: number;
  };
}

interface CacheHealth {
  status: 'healthy' | 'degraded' | 'unreachable' | 'unconfigured';
  provider: CacheProvider;
  latencyMs?: number;
  memoryUsage?: string;
  hitRate?: number;
  message?: string;
  lastChecked: string;
}

// ─── Defaults ────────────────────────────────────────────────

const DEFAULT_REDIS_CONFIG = {
  host: 'localhost',
  port: 6379,
  password: '',
  db: 0,
  tls: false,
  maxRetries: 3,
  poolSize: 10,
};

// ─── Component ───────────────────────────────────────────────

export default function CacheConfiguration() {
  const backendBaseUrl = useBackendConfigStore((s) => s.backendBaseUrl);

  const [provider, setProvider] = useState<CacheProvider>('memory');
  const [redisHost, setRedisHost] = useState(DEFAULT_REDIS_CONFIG.host);
  const [redisPort, setRedisPort] = useState(DEFAULT_REDIS_CONFIG.port);
  const [redisPassword, setRedisPassword] = useState(DEFAULT_REDIS_CONFIG.password);
  const [redisDb, setRedisDb] = useState(DEFAULT_REDIS_CONFIG.db);
  const [redisTls, setRedisTls] = useState(DEFAULT_REDIS_CONFIG.tls);
  const [redisMaxRetries, setRedisMaxRetries] = useState(DEFAULT_REDIS_CONFIG.maxRetries);
  const [redisPoolSize, setRedisPoolSize] = useState(DEFAULT_REDIS_CONFIG.poolSize);

  const [health, setHealth] = useState<CacheHealth | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── Fetch current config ───────────────────────────────────

  const fetchConfig = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch(`${backendBaseUrl}/api/v1/settings/cache`);
      if (res.ok) {
        const data = await res.json();
        if (data.config) {
          setProvider(data.config.provider);
          if (data.config.redis) {
            setRedisHost(data.config.redis.host || DEFAULT_REDIS_CONFIG.host);
            setRedisPort(data.config.redis.port || DEFAULT_REDIS_CONFIG.port);
            setRedisPassword(data.config.redis.password || '');
            setRedisDb(data.config.redis.db ?? DEFAULT_REDIS_CONFIG.db);
            setRedisTls(data.config.redis.tls ?? false);
            setRedisMaxRetries(data.config.redis.maxRetries ?? DEFAULT_REDIS_CONFIG.maxRetries);
            setRedisPoolSize(data.config.redis.poolSize ?? DEFAULT_REDIS_CONFIG.poolSize);
          }
        }
        if (data.health) setHealth(data.health);
      }
    } catch {
      // Backend not available — use defaults
    } finally {
      setIsLoading(false);
    }
  }, [backendBaseUrl]);

  useEffect(() => {
    fetchConfig();
  }, [fetchConfig]);

  // ── Save config ────────────────────────────────────────────

  async function handleSave() {
    setIsSaving(true);
    setError(null);
    const config: CacheConfig = { provider };
    if (provider === 'redis') {
      config.redis = {
        host: redisHost.trim(),
        port: redisPort,
        password: redisPassword,
        db: redisDb,
        tls: redisTls,
        maxRetries: redisMaxRetries,
        poolSize: redisPoolSize,
      };
      if (!redisHost.trim()) {
        toast.error('Redis host is required');
        setIsSaving(false);
        return;
      }
    }
    try {
      const res = await fetch(`${backendBaseUrl}/api/v1/settings/cache`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(body.error || res.statusText);
      }
      const data = await res.json();
      if (data.health) setHealth(data.health);
      toast.success('Cache configuration saved');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to save';
      setError(msg);
      toast.error(msg);
    } finally {
      setIsSaving(false);
    }
  }

  // ── Test connection ────────────────────────────────────────

  async function handleTest() {
    setIsTesting(true);
    setError(null);
    try {
      const res = await fetch(`${backendBaseUrl}/api/v1/settings/cache/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider,
          redis: provider === 'redis'
            ? { host: redisHost, port: redisPort, password: redisPassword, db: redisDb, tls: redisTls }
            : undefined,
        }),
      });
      if (!res.ok) throw new Error('Health check failed');
      const data: CacheHealth = await res.json();
      setHealth(data);
      if (data.status === 'healthy') {
        toast.success('Cache health check passed', { description: `Latency: ${data.latencyMs ?? '?'}ms` });
      } else {
        toast.warning(`Cache status: ${data.status}`, { description: data.message });
      }
    } catch (err) {
      toast.error('Health check failed');
      setHealth({
        status: 'unreachable',
        provider,
        message: err instanceof Error ? err.message : 'Connection failed',
        lastChecked: new Date().toISOString(),
      });
    } finally {
      setIsTesting(false);
    }
  }

  // ── Health status icon ─────────────────────────────────────

  function StatusIcon({ status }: { status: string }) {
    switch (status) {
      case 'healthy':
        return <CheckCircle2 className="h-5 w-5 text-emerald-500" />;
      case 'degraded':
        return <AlertTriangle className="h-5 w-5 text-amber-500" />;
      case 'unreachable':
        return <XCircle className="h-5 w-5 text-red-500" />;
      default:
        return <Database className="h-5 w-5 text-muted-foreground" />;
    }
  }

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          <span className="ml-2 text-sm text-muted-foreground">Loading cache configuration...</span>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Database className="h-5 w-5 text-primary" />
            <div>
              <CardTitle>Cache Configuration</CardTitle>
              <CardDescription>
                Configure the caching layer for improved performance
              </CardDescription>
            </div>
          </div>
          {health && (
            <div className="flex items-center gap-2">
              <StatusIcon status={health.status} />
              <Badge variant={health.status === 'healthy' ? 'default' : health.status === 'degraded' ? 'secondary' : 'destructive'}>
                {health.status}
              </Badge>
            </div>
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-6">
        {error && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {/* Health stats */}
        {health && health.status !== 'unconfigured' && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            className="grid grid-cols-4 gap-4 rounded-lg border p-4"
          >
            <div>
              <div className="text-xs text-muted-foreground">Provider</div>
              <div className="text-sm font-medium capitalize">{health.provider}</div>
            </div>
            {health.latencyMs !== undefined && (
              <div>
                <div className="text-xs text-muted-foreground">Latency</div>
                <div className="text-sm font-medium">{health.latencyMs}ms</div>
              </div>
            )}
            {health.hitRate !== undefined && (
              <div>
                <div className="text-xs text-muted-foreground">Hit Rate</div>
                <div className="text-sm font-medium">{(health.hitRate * 100).toFixed(1)}%</div>
              </div>
            )}
            {health.memoryUsage && (
              <div>
                <div className="text-xs text-muted-foreground">Memory</div>
                <div className="text-sm font-medium">{health.memoryUsage}</div>
              </div>
            )}
          </motion.div>
        )}

        {/* Provider selection */}
        <div className="space-y-3">
          <Label>Cache Provider</Label>
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => setProvider('memory')}
              className={cn(
                'flex items-center gap-3 rounded-xl border-2 p-4 transition-all text-left',
                provider === 'memory'
                  ? 'border-primary bg-primary/5'
                  : 'border-border hover:border-primary/40'
              )}
            >
              <Cpu className={cn('h-5 w-5', provider === 'memory' ? 'text-primary' : 'text-muted-foreground')} />
              <div>
                <div className="text-sm font-medium">In-Memory</div>
                <div className="text-xs text-muted-foreground">Single-instance, no external deps</div>
              </div>
            </button>
            <button
              type="button"
              onClick={() => setProvider('redis')}
              className={cn(
                'flex items-center gap-3 rounded-xl border-2 p-4 transition-all text-left',
                provider === 'redis'
                  ? 'border-primary bg-primary/5'
                  : 'border-border hover:border-primary/40'
              )}
            >
              <Server className={cn('h-5 w-5', provider === 'redis' ? 'text-primary' : 'text-muted-foreground')} />
              <div>
                <div className="text-sm font-medium">Redis</div>
                <div className="text-xs text-muted-foreground">Distributed cache for HA deployments</div>
              </div>
            </button>
          </div>
        </div>

        {/* Redis configuration */}
        {provider === 'redis' && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="space-y-4 border rounded-lg p-4"
          >
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="redis-host">Host</Label>
                <Input
                  id="redis-host"
                  placeholder="localhost"
                  value={redisHost}
                  onChange={(e) => setRedisHost(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="redis-port">Port</Label>
                <Input
                  id="redis-port"
                  type="number"
                  placeholder="6379"
                  value={redisPort}
                  onChange={(e) => setRedisPort(parseInt(e.target.value, 10) || 6379)}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="redis-password">Password</Label>
              <Input
                id="redis-password"
                type="password"
                placeholder="Optional"
                value={redisPassword}
                onChange={(e) => setRedisPassword(e.target.value)}
              />
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label htmlFor="redis-db">Database</Label>
                <Input
                  id="redis-db"
                  type="number"
                  value={redisDb}
                  onChange={(e) => setRedisDb(parseInt(e.target.value, 10) || 0)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="redis-retries">Max Retries</Label>
                <Input
                  id="redis-retries"
                  type="number"
                  value={redisMaxRetries}
                  onChange={(e) => setRedisMaxRetries(parseInt(e.target.value, 10) || 3)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="redis-pool">Pool Size</Label>
                <Input
                  id="redis-pool"
                  type="number"
                  value={redisPoolSize}
                  onChange={(e) => setRedisPoolSize(parseInt(e.target.value, 10) || 10)}
                />
              </div>
            </div>
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div className="space-y-0.5">
                <div className="text-sm font-medium">TLS Encryption</div>
                <div className="text-xs text-muted-foreground">Enable TLS for Redis connection</div>
              </div>
              <Switch checked={redisTls} onCheckedChange={setRedisTls} />
            </div>
          </motion.div>
        )}

        {/* Actions */}
        <div className="flex items-center justify-end gap-2 pt-4 border-t">
          <Button variant="outline" onClick={handleTest} disabled={isTesting}>
            {isTesting ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Testing...
              </>
            ) : (
              <>
                <RefreshCw className="h-4 w-4 mr-2" />
                Health Check
              </>
            )}
          </Button>
          <Button onClick={handleSave} disabled={isSaving}>
            {isSaving ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <Save className="h-4 w-4 mr-2" />
                Save Configuration
              </>
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
