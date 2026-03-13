import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Save, RotateCcw, CheckCircle2, XCircle, Loader2, AlertTriangle, RefreshCw, Download } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { useBackendConfigStore } from '@/stores/backendConfigStore';
import { useAIConfigStore, toBackendProvider, type AIProvider } from '@/stores/aiConfigStore';
import { getHealth } from '@/services/backendApiClient';
import {
  getAIHealth,
  getAIConfiguration,
  updateAIConfiguration,
  getProviderModels,
  validateAIKey,
  type ModelOption,
  type LLMProviderConfigResponse,
} from '@/services/aiService';
import { DEFAULT_BACKEND_BASE_URL, DEFAULT_AI_BASE_URL, DEFAULT_AI_WS_URL } from '@/lib/backendConstants';
import { isTauri } from '@/lib/tauri';

const settingsSchema = z.object({
  backendBaseUrl: z.string().url({ message: 'Please enter a valid URL' }),
  aiBackendUrl: z.string().url({ message: 'Please enter a valid URL' }),
  aiWsUrl: z.string().url({ message: 'Please enter a valid WebSocket URL' }).refine((val) => val.startsWith('ws'), {
    message: 'Must start with ws:// or wss://',
  }),
});

interface DesktopInfo {
  app_version: string;
  backend_port: number;
  backend_version: string | null;
  backend_uptime_seconds: number | null;
  kubeconfig_path: string;
  app_data_dir: string;
}

interface AISidecarStatus {
  available: boolean;
  running: boolean;
  port: number;
}

export default function Settings() {
  // Backend config store (consolidated URL state)
  const {
    backendBaseUrl,
    aiBackendUrl,
    aiWsUrl,
    setBackendBaseUrl,
    setAiBackendUrl,
    setAiWsUrl
  } = useBackendConfigStore();
  const { provider, apiKey, model, customEndpoint, enabled, setProvider, setApiKey, setModel, setCustomEndpoint, setEnabled } = useAIConfigStore();
  const [isTesting, setIsTesting] = useState<string | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<Record<string, 'success' | 'error' | null>>({});
  const [desktopInfo, setDesktopInfo] = useState<DesktopInfo | null>(null);
  const [aiStatus, setAiStatus] = useState<AISidecarStatus | null>(null);
  const [isRestarting, setIsRestarting] = useState(false);
  const [isCheckingUpdate, setIsCheckingUpdate] = useState(false);
  const [analyticsConsent, setAnalyticsConsent] = useState<boolean | null>(null);
  const [isUpdatingAnalytics, setIsUpdatingAnalytics] = useState(false);
  const [isSavingAIConfig, setIsSavingAIConfig] = useState(false);
  // Model catalog loaded from the backend (provider → model list)
  const [modelCatalog, setModelCatalog] = useState<Record<string, ModelOption[]>>({});
  // True when user picked "Other (enter manually)" from the model dropdown
  const [showCustomModel, setShowCustomModel] = useState(false);
  // Inline validation feedback for the API key / model
  const [keyValidation, setKeyValidation] = useState<{ ok: boolean; msg: string } | null>(null);
  // Use build-time constant first (timing-independent), fall back to runtime check
  const isDesktop = (typeof __VITE_IS_TAURI_BUILD__ !== 'undefined' && __VITE_IS_TAURI_BUILD__) || isTauri();

  const form = useForm<z.infer<typeof settingsSchema>>({
    resolver: zodResolver(settingsSchema),
    defaultValues: {
      backendBaseUrl,
      aiBackendUrl,
      aiWsUrl,
    },
  });

  useEffect(() => {
    if (isDesktop) {
      loadDesktopInfo();
      loadAIStatus();
      loadAnalyticsConsent();
    }
  }, [isDesktop]);

  // Hydrate AI config fields from the backend on mount.
  // Backend is source of truth — overrides any stale localStorage values.
  // apiKey is intentionally NOT returned by the backend (security).
  useEffect(() => {
    getAIConfiguration()
      .then((cfg: LLMProviderConfigResponse) => {
        if (!cfg || !cfg.provider || cfg.provider === 'none') return;
        setProvider(cfg.provider as AIProvider);
        if (cfg.model) setModel(cfg.model);
        if (cfg.base_url) setCustomEndpoint(cfg.base_url);
        // Mark AI as enabled if we have a live backend config
        if (cfg.configured) setEnabled(true);
      })
      .catch(() => {
        // AI backend not running yet — local store values are fine as defaults
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load model catalog from the backend once.
  useEffect(() => {
    getProviderModels()
      .then((resp) => setModelCatalog(resp.models))
      .catch(() => {
        // Backend not yet running — we'll show a free-text input as fallback
      });
  }, []);

  // When the provider changes, auto-select the recommended model from the catalog.
  // Also reset validation state and custom-model toggle.
  useEffect(() => {
    setKeyValidation(null);
    const list = modelCatalog[provider] ?? [];
    const recommended = list.find((m) => m.recommended);
    if (recommended) {
      setModel(recommended.id);
      setShowCustomModel(false);
    } else if (list.length === 0 && provider !== 'custom') {
      // Catalog not loaded yet or empty — keep existing model, show free text
      setShowCustomModel(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider, modelCatalog]);

  async function loadAnalyticsConsent() {
    if (!isDesktop) return;
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const consent = await invoke<boolean>('get_analytics_consent');
      setAnalyticsConsent(consent);
    } catch (error) {
      console.error('Failed to load analytics consent:', error);
    }
  }

  async function handleToggleAnalytics(enabled: boolean) {
    if (!isDesktop) return;
    setIsUpdatingAnalytics(true);
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('set_analytics_consent', { consent: enabled });
      setAnalyticsConsent(enabled);
      toast.success(enabled ? 'Analytics enabled' : 'Analytics disabled');
    } catch (error) {
      toast.error(`Failed to update analytics setting: ${error}`);
    } finally {
      setIsUpdatingAnalytics(false);
    }
  }

  async function loadDesktopInfo() {
    if (!isDesktop) return;
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const info = await invoke<DesktopInfo>('get_desktop_info');
      setDesktopInfo(info);
    } catch (error) {
      console.error('Failed to load desktop info:', error);
    }
  }

  async function loadAIStatus() {
    if (!isDesktop) return;
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const status = await invoke<AISidecarStatus>('get_ai_status');
      setAiStatus(status);
    } catch (error) {
      console.error('Failed to load AI status:', error);
    }
  }

  async function handleRestartBackend() {
    if (!isDesktop) return;
    setIsRestarting(true);
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('restart_sidecar');
      toast.success('Backend restarted successfully');
      setTimeout(() => {
        loadDesktopInfo();
        loadAIStatus();
      }, 2000);
    } catch (error) {
      toast.error(`Failed to restart backend: ${error}`);
    } finally {
      setIsRestarting(false);
    }
  }

  async function handleCheckForUpdates() {
    if (!isDesktop) return;
    setIsCheckingUpdate(true);
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const update = await invoke<{ version: string } | null>('check_for_updates');
      if (update) {
        toast.success(`Update available: ${update.version}`, {
          action: {
            label: 'Install',
            onClick: async () => {
              try {
                const { invoke: invokeUpdate } = await import('@tauri-apps/api/core');
                await invokeUpdate('install_update');
                toast.success('Update installed. Please restart the application.');
              } catch (error) {
                toast.error(`Failed to install update: ${error}`);
              }
            },
          },
        });
      } else {
        toast.info('You are running the latest version');
      }
    } catch (error) {
      toast.error(`Failed to check for updates: ${error}`);
    } finally {
      setIsCheckingUpdate(false);
    }
  }

  function formatUptime(seconds: number | null): string {
    if (!seconds) return 'Unknown';
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    if (days > 0) return `${days}d ${hours}h ${minutes}m`;
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
  }

  async function testConnection(type: 'backend' | 'ai') {
    setIsTesting(type);
    setConnectionStatus((prev) => ({ ...prev, [type]: null }));

    try {
      const values = form.getValues();
      if (type === 'backend') {
        await getHealth(values.backendBaseUrl);
      } else {
        // We can't easily test AI URL because aiService uses the store value globally.
        // But we can temporarily use fetch directly or update store momentarily?
        // Actually, aiService uses `getCurrentAiBackendUrl()`.
        // Let's implement a direct check or just rely on save.
        // For now, simpler to just Try/Catch using fetch directly to avoid breaking global state during test.
        const res = await fetch(`${values.aiBackendUrl}/health`);
        if (!res.ok) throw new Error('Health check failed');
      }

      setConnectionStatus((prev) => ({ ...prev, [type]: 'success' }));
      toast.success(`${type === 'backend' ? 'Backend' : 'AI'} connection successful`);
    } catch (error) {
      console.error(error);
      setConnectionStatus((prev) => ({ ...prev, [type]: 'error' }));
      toast.error(`Could not connect to ${type === 'backend' ? 'Backend' : 'AI Service'}`);
    } finally {
      setIsTesting(null);
    }
  }

  function onSubmit(values: z.infer<typeof settingsSchema>) {
    setBackendBaseUrl(values.backendBaseUrl);
    setAiBackendUrl(values.aiBackendUrl);
    setAiWsUrl(values.aiWsUrl);

    toast.success('Settings saved', {
      description: 'Reloading application to apply changes...',
    });

    // Force reload to ensure all sockets/singletons reconnect with new URLs
    setTimeout(() => {
      window.location.reload();
    }, 1500);
  }

  const handleReset = () => {
    setBackendBaseUrl(DEFAULT_BACKEND_BASE_URL);
    setAiBackendUrl(DEFAULT_AI_BASE_URL);
    setAiWsUrl(DEFAULT_AI_WS_URL);

    form.reset({
      backendBaseUrl: DEFAULT_BACKEND_BASE_URL,
      aiBackendUrl: DEFAULT_AI_BASE_URL,
      aiWsUrl: DEFAULT_AI_WS_URL
    });

    toast.info('Restored default settings');
  };

  return (
    <div className="container max-w-2xl py-10 space-y-8">
      <div>
        <h1 className="text-3xl font-bold">Settings</h1>
        <p className="text-muted-foreground">Configure connection endpoints for Kubilitics.</p>
      </div>

      <Alert>
        <AlertTriangle className="h-4 w-4" />
        <AlertTitle>Configuration Change</AlertTitle>
        <AlertDescription>
          Changing these values will reload the application. Ensure the new endpoints are reachable.
        </AlertDescription>
      </Alert>

      <Card>
        <CardHeader>
          <CardTitle>Connection Endpoints</CardTitle>
          <CardDescription>
            Manage the URLs for the Core Backend and AI Service.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
              {/* Backend URL */}
              <FormField
                control={form.control}
                name="backendBaseUrl"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Core Backend URL</FormLabel>
                    <div className="flex gap-2">
                      <FormControl>
                        <Input {...field} />
                      </FormControl>
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        onClick={() => testConnection('backend')}
                        disabled={!!isTesting}
                      >
                        {isTesting === 'backend' ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : connectionStatus.backend === 'success' ? (
                          <CheckCircle2 className="h-4 w-4 text-green-500" />
                        ) : connectionStatus.backend === 'error' ? (
                          <XCircle className="h-4 w-4 text-red-500" />
                        ) : (
                          <RotateCcw className="h-4 w-4" /> // Using RotateCcw as "Test" icon proxy or verify icon
                        )}
                      </Button>
                    </div>
                    <FormDescription>
                      The URL where the Kubilitics Core Go backend is running (default port 819).
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* AI Backend URL */}
              <FormField
                control={form.control}
                name="aiBackendUrl"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>AI Service URL</FormLabel>
                    <div className="flex gap-2">
                      <FormControl>
                        <Input {...field} />
                      </FormControl>
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        onClick={() => testConnection('ai')}
                        disabled={!!isTesting}
                      >
                        {isTesting === 'ai' ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : connectionStatus.ai === 'success' ? (
                          <CheckCircle2 className="h-4 w-4 text-green-500" />
                        ) : connectionStatus.ai === 'error' ? (
                          <XCircle className="h-4 w-4 text-red-500" />
                        ) : (
                          <RotateCcw className="h-4 w-4" />
                        )}
                      </Button>
                    </div>
                    <FormDescription>
                      HTTP endpoint for the AI service (default port 8081).
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* AI WebSocket URL */}
              <FormField
                control={form.control}
                name="aiWsUrl"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>AI WebSocket URL</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormDescription>
                      WebSocket endpoint for the AI service.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="flex justify-between pt-4">
                <Button type="button" variant="ghost" onClick={handleReset}>
                  Reset to Defaults
                </Button>
                <Button type="submit">
                  <Save className="mr-2 h-4 w-4" />
                  Save Changes
                </Button>
              </div>
            </form>
          </Form>
        </CardContent>
      </Card>

      {/* AI Configuration */}
      <Card>
        <CardHeader>
          <CardTitle>AI Configuration</CardTitle>
          <CardDescription>
            Configure your AI provider for intelligent cluster insights and assistance.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Global AI Enable/Disable */}
          <div className="flex items-center justify-between space-x-2 rounded-lg border p-4">
            <div className="space-y-0.5">
              <div className="text-sm font-medium">Enable AI Features</div>
              <div className="text-xs text-muted-foreground">
                Turn AI assistance on or off globally
              </div>
            </div>
            <Switch checked={enabled} onCheckedChange={setEnabled} />
          </div>

          {/* AI Provider Selection */}
          <div className="space-y-2">
            <label className="text-sm font-medium">AI Provider</label>
            <Select value={provider} onValueChange={(value) => {
              setProvider(value as AIProvider);
              // Model auto-selected by the useEffect above when catalog loads
            }}>
              <SelectTrigger>
                <SelectValue placeholder="Select AI provider" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="openai">OpenAI</SelectItem>
                <SelectItem value="anthropic">Anthropic (Claude)</SelectItem>
                <SelectItem value="azure">Azure OpenAI</SelectItem>
                <SelectItem value="ollama">Ollama (Local)</SelectItem>
                <SelectItem value="custom">Custom Endpoint</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Choose your preferred LLM provider (BYOLLM - Bring Your Own LLM)
            </p>
          </div>

          {/* API Key */}
          <div className="space-y-2">
            <label className="text-sm font-medium">API Key</label>
            <Input
              type="password"
              placeholder={provider === 'ollama' ? 'Not required for Ollama' : 'Enter your API key'}
              value={apiKey}
              onChange={(e) => { setApiKey(e.target.value); setKeyValidation(null); }}
              disabled={provider === 'ollama'}
            />
            <p className="text-xs text-muted-foreground">
              {provider === 'ollama'
                ? 'Ollama runs locally and does not require an API key'
                : 'Your API key is sent to the backend and never stored in the browser'}
            </p>
          </div>

          {/* Model — smart dropdown with curated list + "Other" escape hatch */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Model</label>
            {(() => {
              const catalogKey = provider === 'azure' ? 'custom' : provider;
              const modelList = modelCatalog[catalogKey] ?? [];
              const isInList = modelList.some((m) => m.id === model);
              const showDropdown = modelList.length > 0 && provider !== 'custom' && provider !== 'azure';
              return (
                <>
                  {showDropdown && (
                    <Select
                      value={isInList ? model : (showCustomModel ? '__other__' : '')}
                      onValueChange={(val) => {
                        if (val === '__other__') {
                          setShowCustomModel(true);
                          setModel('');
                        } else {
                          setShowCustomModel(false);
                          setModel(val);
                        }
                        setKeyValidation(null);
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select model…" />
                      </SelectTrigger>
                      <SelectContent>
                        {modelList.map((m) => (
                          <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
                        ))}
                        <SelectItem value="__other__">Other (enter manually)</SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                  {(!showDropdown || showCustomModel) && (
                    <Input
                      placeholder={
                        provider === 'openai' ? 'e.g., gpt-4o' :
                          provider === 'anthropic' ? 'e.g., claude-sonnet-4-5' :
                            provider === 'azure' ? 'e.g., gpt-4' :
                              provider === 'ollama' ? 'e.g., llama3.2' :
                                'Enter exact model name'
                      }
                      value={model}
                      onChange={(e) => { setModel(e.target.value); setKeyValidation(null); }}
                    />
                  )}
                </>
              );
            })()}
            {keyValidation && (
              <p className={`text-xs flex items-center gap-1 ${keyValidation.ok ? 'text-green-600' : 'text-red-500'}`}>
                {keyValidation.ok ? <CheckCircle2 className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
                {keyValidation.msg}
              </p>
            )}
            {!keyValidation && (
              <p className="text-xs text-muted-foreground">
                {modelCatalog[provider]?.length
                  ? 'Select from the list or choose "Other" to enter a custom model name'
                  : 'Enter the exact model name for your provider'}
              </p>
            )}
          </div>

          {/* Endpoint URL — required for ollama, azure, and custom providers */}
          {(provider === 'custom' || provider === 'ollama' || provider === 'azure') && (
            <div className="space-y-2">
              <label className="text-sm font-medium">
                {provider === 'ollama' ? 'Ollama Base URL' : 'Endpoint URL'}
              </label>
              <Input
                placeholder={
                  provider === 'ollama'
                    ? 'http://localhost:11434'
                    : provider === 'azure'
                      ? 'https://<resource>.openai.azure.com/openai/deployments/<deployment>'
                      : 'https://your-llm-endpoint.com/v1'
                }
                value={customEndpoint}
                onChange={(e) => setCustomEndpoint(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                {provider === 'ollama'
                  ? 'Base URL of your local Ollama instance'
                  : provider === 'azure'
                    ? 'Azure OpenAI deployment endpoint (mapped to custom provider on backend)'
                    : 'OpenAI-compatible API endpoint'}
              </p>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-2 pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={async () => {
                setIsTesting('ai-config');
                try {
                  await getAIHealth();
                  setConnectionStatus((prev) => ({ ...prev, 'ai-config': 'success' }));
                  toast.success('AI service connection successful');
                } catch (error) {
                  setConnectionStatus((prev) => ({ ...prev, 'ai-config': 'error' }));
                  toast.error('Could not connect to AI service');
                } finally {
                  setIsTesting(null);
                }
              }}
              disabled={!!isTesting}
            >
              {isTesting === 'ai-config' ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Testing...
                </>
              ) : connectionStatus['ai-config'] === 'success' ? (
                <>
                  <CheckCircle2 className="mr-2 h-4 w-4 text-green-500" />
                  Test Connection
                </>
              ) : connectionStatus['ai-config'] === 'error' ? (
                <>
                  <XCircle className="mr-2 h-4 w-4 text-red-500" />
                  Test Connection
                </>
              ) : (
                <>
                  <RotateCcw className="mr-2 h-4 w-4" />
                  Test Connection
                </>
              )}
            </Button>
            <Button
              onClick={async () => {
                setIsSavingAIConfig(true);
                setKeyValidation(null);
                try {
                  // Map UI provider to backend provider:
                  //   'azure' → 'custom'  (backend doesn't know about azure)
                  //   'none'  → skip save (nothing configured)
                  if (provider === 'none') {
                    toast.error('Please select an AI provider first');
                    return;
                  }
                  const backendProvider = toBackendProvider(provider);
                  const needsBaseUrl = provider === 'ollama' || provider === 'custom' || provider === 'azure';
                  const configPayload = {
                    provider: backendProvider,
                    api_key: apiKey ? apiKey.trim() : undefined,
                    model: model ? model.trim() : undefined,
                    base_url: needsBaseUrl ? customEndpoint.trim() : undefined,
                  };

                  // Validate the key + model before saving.
                  // Ollama skips API key validation (no key needed).
                  if (backendProvider !== 'ollama') {
                    const validation = await validateAIKey(configPayload);
                    if (!validation.valid) {
                      const errMsg = validation.error || validation.message || 'API key or model is invalid';
                      setKeyValidation({ ok: false, msg: errMsg });
                      toast.error(errMsg);
                      return;
                    }
                    setKeyValidation({ ok: true, msg: 'API key and model verified ✓' });
                  }

                  await updateAIConfiguration(configPayload);
                  // Mark AI as enabled now that we have a valid config
                  if (!enabled) setEnabled(true);
                  toast.success('AI configuration saved successfully');
                } catch (error) {
                  toast.error(`Failed to save AI configuration: ${error}`);
                } finally {
                  setIsSavingAIConfig(false);
                }
              }}
              disabled={isSavingAIConfig}
            >
              {isSavingAIConfig ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <Save className="mr-2 h-4 w-4" />
                  Save AI Configuration
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      {isDesktop && (
        <Card>
          <CardHeader>
            <CardTitle>Desktop Settings</CardTitle>
            <CardDescription>
              Desktop-specific configuration and status information.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* App Version */}
            {desktopInfo && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">App Version</p>
                    <p className="text-sm">{desktopInfo.app_version}</p>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Backend Port</p>
                    <p className="text-sm">{desktopInfo.backend_port}</p>
                  </div>
                  {desktopInfo.backend_version && (
                    <div>
                      <p className="text-sm font-medium text-muted-foreground">Backend Version</p>
                      <p className="text-sm">{desktopInfo.backend_version}</p>
                    </div>
                  )}
                  {desktopInfo.backend_uptime_seconds !== null && (
                    <div>
                      <p className="text-sm font-medium text-muted-foreground">Backend Uptime</p>
                      <p className="text-sm">{formatUptime(desktopInfo.backend_uptime_seconds)}</p>
                    </div>
                  )}
                </div>

                <div className="space-y-2">
                  <p className="text-sm font-medium text-muted-foreground">Kubeconfig Path</p>
                  <p className="text-sm font-mono break-all">{desktopInfo.kubeconfig_path}</p>
                </div>

                <div className="space-y-2">
                  <p className="text-sm font-medium text-muted-foreground">App Data Directory</p>
                  <p className="text-sm font-mono break-all">{desktopInfo.app_data_dir}</p>
                </div>
              </div>
            )}

            {/* AI Backend Status */}
            {aiStatus && (
              <div className="space-y-2">
                <p className="text-sm font-medium text-muted-foreground">AI Backend Status</p>
                <div className="flex items-center gap-2">
                  <div className={`h-2 w-2 rounded-full ${aiStatus.running ? 'bg-green-500' : aiStatus.available ? 'bg-yellow-500' : 'bg-gray-400'}`} />
                  <p className="text-sm">
                    {aiStatus.running
                      ? `Running on port ${aiStatus.port}`
                      : aiStatus.available
                        ? 'Stopped (available)'
                        : 'Not bundled'}
                  </p>
                </div>
              </div>
            )}

            {/* Analytics Consent */}
            <div className="space-y-2 pt-4 border-t">
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <p className="text-sm font-medium">Analytics & Usage Data</p>
                  <p className="text-xs text-muted-foreground">
                    Help improve Kubilitics by sharing anonymous usage data
                  </p>
                </div>
                {analyticsConsent !== null && (
                  <div className="flex items-center space-x-2">
                    <span className="text-sm text-muted-foreground">
                      {analyticsConsent ? 'Enabled' : 'Disabled'}
                    </span>
                    <Button
                      type="button"
                      variant={analyticsConsent ? "destructive" : "default"}
                      size="sm"
                      onClick={() => handleToggleAnalytics(!analyticsConsent)}
                      disabled={isUpdatingAnalytics}
                    >
                      {isUpdatingAnalytics ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : analyticsConsent ? (
                        'Disable'
                      ) : (
                        'Enable'
                      )}
                    </Button>
                  </div>
                )}
              </div>
            </div>

            {/* Actions */}
            <div className="flex gap-2 pt-4 border-t">
              <Button
                type="button"
                variant="outline"
                onClick={handleRestartBackend}
                disabled={isRestarting}
              >
                {isRestarting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Restarting...
                  </>
                ) : (
                  <>
                    <RefreshCw className="mr-2 h-4 w-4" />
                    Restart Backend
                  </>
                )}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={handleCheckForUpdates}
                disabled={isCheckingUpdate}
              >
                {isCheckingUpdate ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Checking...
                  </>
                ) : (
                  <>
                    <Download className="mr-2 h-4 w-4" />
                    Check for Updates
                  </>
                )}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
