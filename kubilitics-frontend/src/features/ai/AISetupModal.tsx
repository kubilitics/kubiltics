import { useState, useEffect } from 'react';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import {
    Bot,
    Key,
    Eye,
    EyeOff,
    CheckCircle2,
    AlertCircle,
    Loader2,
    Zap,
} from 'lucide-react';
import { toast } from '@/components/ui/sonner';
import {
    updateAIConfiguration,
    getAIConfiguration,
    getAIInfo,
    getProviderModels,
    validateAIKey,
    type LLMProviderConfig,
    type LLMProviderConfigResponse,
    type ModelOption,
} from '@/services/aiService';
import { toBackendProvider } from '@/stores/aiConfigStore';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/lib/utils';

const AI_PROVIDER_OPTIONS = [
    { value: 'openai', label: 'OpenAI (GPT-4, GPT-3.5)', icon: 'openai' },
    { value: 'anthropic', label: 'Anthropic (Claude)', icon: 'anthropic' },
    { value: 'ollama', label: 'Ollama (Local LLM)', icon: 'ollama' },
    { value: 'custom', label: 'Custom (OpenAI-compatible)', icon: 'custom' },
] as const;

interface AISetupModalProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onComplete?: () => void;
}

export function AISetupModal({ open, onOpenChange, onComplete }: AISetupModalProps) {
    const [aiConfig, setAiConfig] = useState<LLMProviderConfig>({ provider: 'openai' });
    const [showApiKey, setShowApiKey] = useState(false);
    const [testStatus, setTestStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
    // Model catalog fetched from backend: provider → list of models
    const [modelCatalog, setModelCatalog] = useState<Record<string, ModelOption[]>>({});
    // True when user chose "Other (enter manually)" from the model dropdown
    const [showCustomModel, setShowCustomModel] = useState(false);

    useEffect(() => {
        if (!open) return;
        // Hydrate from backend on open (GET /api/v1/config/provider).
        // The backend never returns the api_key (security) — user must re-enter it if changing.
        // We do NOT read api_key from localStorage — it is intentionally not persisted there.
        getAIConfiguration()
            .then((saved: LLMProviderConfigResponse) => {
                if (saved && saved.provider && saved.provider !== 'none') {
                    setAiConfig((prev) => ({
                        ...prev,
                        provider: saved.provider as LLMProviderConfig['provider'],
                        model: saved.model ?? prev.model,
                        base_url: saved.base_url ?? prev.base_url,
                        // api_key intentionally NOT restored — user must re-enter to validate
                    }));
                }
            })
            .catch(() => {
                // AI backend may not be running yet — stay with defaults
            });

        // Load model catalog (fast, static endpoint — no auth required)
        getProviderModels()
            .then((resp) => setModelCatalog(resp.models))
            .catch(() => {
                // Backend not running yet — free-text fallback used automatically
            });
    }, [open]);

    // When provider changes, auto-select the recommended model from the catalog.
    const handleProviderChange = (newProvider: LLMProviderConfig['provider']) => {
        if ((newProvider as string) === 'none') return; // 'none' is not a valid setup choice
        const list = modelCatalog[newProvider] ?? [];
        const recommended = list.find((m) => m.recommended);
        setShowCustomModel(false);
        setAiConfig((prev) => ({
            ...prev,
            provider: newProvider,
            // Use catalog recommended model; fall back to sensible hardcoded defaults
            // matching what buildModelCatalog() returns (single source of truth on backend).
            model: recommended?.id ?? (
                newProvider === 'openai' ? 'gpt-4o' :
                    newProvider === 'anthropic' ? 'claude-sonnet-4-5' :
                        newProvider === 'ollama' ? 'llama3.2' : ''
            ),
            base_url: newProvider === 'ollama' ? 'http://localhost:11434' : prev.base_url,
            api_key: '', // Clear key when switching providers — user must re-enter
        }));
        setTestStatus('idle');
    };

    // Re-apply recommended model when catalog loads (for the current provider)
    useEffect(() => {
        if (Object.keys(modelCatalog).length === 0) return;
        const list = modelCatalog[aiConfig.provider] ?? [];
        const recommended = list.find((m) => m.recommended);
        if (recommended && !aiConfig.model) {
            setAiConfig((prev) => ({ ...prev, model: recommended.id }));
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [modelCatalog]);

    const handleSave = async () => {
        if ((aiConfig.provider as string) === 'none') {
            toast.error('Please select an AI provider first');
            return;
        }

        // Map UI provider to backend provider (azure → custom, etc.)
        const backendProvider = toBackendProvider(aiConfig.provider as Parameters<typeof toBackendProvider>[0]);
        const needsBaseUrl = aiConfig.provider === 'ollama' || aiConfig.provider === 'custom';
        const configPayload: LLMProviderConfig = {
            provider: backendProvider,
            api_key: aiConfig.api_key,
            model: aiConfig.model,
            base_url: needsBaseUrl ? aiConfig.base_url : undefined,
        };

        // Validate required endpoint for ollama/custom
        if (needsBaseUrl && !configPayload.base_url?.trim()) {
            setTestStatus('error');
            toast.error('Endpoint URL is required for this provider');
            return;
        }

        setTestStatus('loading');
        try {
            // Validate the key + model against the provider before saving.
            // Ollama doesn't require an API key — skip validation for it.
            if (backendProvider !== 'ollama') {
                const validation = await validateAIKey(configPayload);
                if (!validation.valid) {
                    setTestStatus('error');
                    const errMsg = validation.error || validation.message || 'API key or model is invalid';
                    toast.error(errMsg);
                    return;
                }
            }

            // POST provider config to backend (hot-wires the LLM adapter at runtime)
            await updateAIConfiguration(configPayload);
            // Verify the connection is live after the config change
            await getAIInfo();
            setTestStatus('success');
            toast.success('AI Engine connected successfully!');
            setTimeout(() => {
                onOpenChange(false);
                onComplete?.();
            }, 1500);
        } catch (err: any) {
            setTestStatus('error');
            let errorMessage = 'Failed to connect to AI Engine';
            if (err.message) {
                if (err.message.includes('CORS') || err.message.includes('access control')) {
                    errorMessage = 'CORS error: AI backend may not be running or configured correctly';
                } else if (err.message.includes('401') || err.message.includes('403') || err.message.includes('unauthorized')) {
                    errorMessage = 'API key is invalid or expired. Please check your API key.';
                } else if (err.message.includes('network') || err.message.includes('fetch')) {
                    errorMessage = 'Cannot reach AI backend. Ensure the AI service is running on localhost:8081';
                } else {
                    errorMessage = err.message;
                }
            }
            toast.error(errorMessage);
        }
    };

    // Determine model list and whether the current model is in the list
    const modelList = modelCatalog[aiConfig.provider] ?? [];
    const currentModelInList = modelList.some((m) => m.id === aiConfig.model);
    const showModelDropdown = modelList.length > 0 && aiConfig.provider !== 'custom';

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[480px] p-0 overflow-hidden bg-white border-none rounded-[2.5rem] shadow-2xl shadow-slate-200">
                <div className="relative h-1.5 bg-blue-600/10">
                    <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: testStatus === 'loading' ? '100%' : '0%' }}
                        transition={{ duration: 2, repeat: Infinity }}
                        className="h-full bg-blue-600"
                    />
                </div>

                <div className="p-10">
                    <DialogHeader className="mb-8">
                        <div className="flex items-center gap-4 mb-4">
                            <div className="p-3 rounded-2xl bg-blue-50">
                                <Bot className="h-6 w-6 text-blue-600" />
                            </div>
                            <DialogTitle className="text-2xl font-bold text-slate-900 tracking-tight">Intelligence Setup</DialogTitle>
                        </div>
                        <DialogDescription className="text-slate-500 text-base leading-relaxed">
                            Connect your preferred LLM to enable anomaly detection and proactive optimization across your ecosystem.
                        </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-6">
                        {/* Provider selector */}
                        <div className="space-y-2">
                            <Label className="text-xs font-bold uppercase tracking-wider text-slate-400 pl-1">Service Provider</Label>
                            <Select value={aiConfig.provider} onValueChange={(v) => handleProviderChange(v as LLMProviderConfig['provider'])}>
                                <SelectTrigger className="bg-slate-50/50 border-slate-100 text-slate-900 h-12 rounded-xl focus:ring-blue-100">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent className="bg-white border-slate-100 text-slate-900 rounded-xl shadow-xl">
                                    {AI_PROVIDER_OPTIONS.map((opt) => (
                                        <SelectItem key={opt.value} value={opt.value} className="focus:bg-slate-50 rounded-lg mx-1">
                                            {opt.label}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        <AnimatePresence mode="wait">
                            <motion.div
                                key={aiConfig.provider}
                                initial={{ opacity: 0, y: 10 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: -10 }}
                                className="space-y-4"
                            >
                                {/* API Key — hidden for Ollama */}
                                {(aiConfig.provider === 'openai' || aiConfig.provider === 'anthropic' || aiConfig.provider === 'custom') && (
                                    <div className="space-y-2">
                                        <Label className="text-xs font-bold uppercase tracking-wider text-slate-400 pl-1">Private API Key</Label>
                                        <div className="relative group">
                                            <Key className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 group-focus-within:text-blue-500 transition-colors" />
                                            <Input
                                                type={showApiKey ? 'text' : 'password'}
                                                placeholder={aiConfig.provider === 'openai' ? 'sk-...' : aiConfig.provider === 'anthropic' ? 'sk-ant-...' : 'Your API key'}
                                                value={aiConfig.api_key || ''}
                                                onChange={(e) => setAiConfig({ ...aiConfig, api_key: e.target.value })}
                                                className="pl-10 pr-10 bg-slate-50/50 border-slate-100 text-slate-900 h-12 rounded-xl font-mono focus:ring-blue-100"
                                            />
                                            <button
                                                type="button"
                                                onClick={() => setShowApiKey(!showApiKey)}
                                                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-1"
                                            >
                                                {showApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                                            </button>
                                        </div>
                                    </div>
                                )}

                                {/* Endpoint URL — for Ollama and Custom */}
                                {(aiConfig.provider === 'ollama' || aiConfig.provider === 'custom') && (
                                    <div className="space-y-2">
                                        <Label className="text-xs font-bold uppercase tracking-wider text-slate-400 pl-1">Endpoint URL</Label>
                                        <Input
                                            placeholder={aiConfig.provider === 'ollama' ? 'http://localhost:11434' : 'http://api.your-provider.com/v1'}
                                            value={aiConfig.base_url || ''}
                                            onChange={(e) => setAiConfig({ ...aiConfig, base_url: e.target.value })}
                                            className="bg-slate-50/50 border-slate-100 text-slate-900 h-12 rounded-xl font-mono focus:ring-blue-100"
                                        />
                                    </div>
                                )}

                                {/* Model — smart dropdown when catalog is available */}
                                <div className="space-y-2">
                                    <Label className="text-xs font-bold uppercase tracking-wider text-slate-400 pl-1">Model</Label>
                                    {showModelDropdown && (
                                        <Select
                                            value={currentModelInList ? (aiConfig.model ?? '') : (showCustomModel ? '__other__' : '')}
                                            onValueChange={(val) => {
                                                if (val === '__other__') {
                                                    setShowCustomModel(true);
                                                    setAiConfig({ ...aiConfig, model: '' });
                                                } else {
                                                    setShowCustomModel(false);
                                                    setAiConfig({ ...aiConfig, model: val });
                                                }
                                            }}
                                        >
                                            <SelectTrigger className="bg-slate-50/50 border-slate-100 text-slate-900 h-12 rounded-xl focus:ring-blue-100">
                                                <SelectValue placeholder="Select model…" />
                                            </SelectTrigger>
                                            <SelectContent className="bg-white border-slate-100 text-slate-900 rounded-xl shadow-xl">
                                                {modelList.map((m) => (
                                                    <SelectItem key={m.id} value={m.id} className="focus:bg-slate-50 rounded-lg mx-1">
                                                        {m.name}
                                                    </SelectItem>
                                                ))}
                                                <SelectItem value="__other__" className="focus:bg-slate-50 rounded-lg mx-1 text-slate-500">
                                                    Other (enter manually)
                                                </SelectItem>
                                            </SelectContent>
                                        </Select>
                                    )}
                                    {(!showModelDropdown || showCustomModel) && (
                                        <Input
                                            placeholder={
                                                aiConfig.provider === 'openai' ? 'e.g. gpt-4o' :
                                                    aiConfig.provider === 'anthropic' ? 'e.g. claude-sonnet-4-5' :
                                                        aiConfig.provider === 'ollama' ? 'e.g. llama3.2' :
                                                            'Enter exact model name'
                                            }
                                            value={aiConfig.model || ''}
                                            onChange={(e) => setAiConfig({ ...aiConfig, model: e.target.value })}
                                            className="bg-slate-50/50 border-slate-100 text-slate-900 h-12 rounded-xl font-mono focus:ring-blue-100"
                                        />
                                    )}
                                    {showModelDropdown && (
                                        <p className="text-[10px] text-slate-400 pl-1">
                                            Select from curated models or choose "Other" to enter a custom name
                                        </p>
                                    )}
                                </div>
                            </motion.div>
                        </AnimatePresence>
                    </div>

                    <div className="mt-10 space-y-4">
                        <AnimatePresence>
                            {testStatus !== 'idle' && (
                                <motion.div
                                    initial={{ opacity: 0, height: 0 }}
                                    animate={{ opacity: 1, height: 'auto' }}
                                    exit={{ opacity: 0, height: 0 }}
                                    className={cn(
                                        "p-4 rounded-xl border flex items-center gap-3",
                                        testStatus === 'loading' ? "bg-blue-50/50 border-blue-100 text-blue-600" :
                                            testStatus === 'success' ? "bg-emerald-50/50 border-emerald-100 text-emerald-600" :
                                                "bg-rose-50/50 border-rose-100 text-rose-600"
                                    )}
                                >
                                    {testStatus === 'loading' ? (
                                        <Loader2 className="h-4 w-4 animate-spin" />
                                    ) : testStatus === 'success' ? (
                                        <CheckCircle2 className="h-4 w-4" />
                                    ) : (
                                        <AlertCircle className="h-4 w-4" />
                                    )}
                                    <span className="text-xs font-bold uppercase tracking-wider">
                                        {testStatus === 'loading' ? 'Establishing secure link...' :
                                            testStatus === 'success' ? 'Engine Ready · Proactive Sync Active' :
                                                'Connection Interrupted · Verification Failed'}
                                    </span>
                                </motion.div>
                            )}
                        </AnimatePresence>

                        <div className="flex gap-3">
                            <Button
                                variant="ghost"
                                className="flex-1 text-slate-500 hover:text-slate-900 hover:bg-slate-100 rounded-xl h-12 font-semibold"
                                onClick={() => onOpenChange(false)}
                            >
                                Back
                            </Button>
                            <Button
                                className={cn(
                                    "flex-[1.5] h-12 rounded-xl text-white font-bold transition-all shadow-lg",
                                    testStatus === 'success' ? 'bg-emerald-600 shadow-emerald-600/20' :
                                        testStatus === 'error' ? 'bg-rose-600 shadow-rose-600/20' :
                                            'bg-blue-600 hover:bg-blue-700 shadow-blue-600/20'
                                )}
                                onClick={handleSave}
                                disabled={testStatus === 'loading'}
                            >
                                {testStatus === 'loading' ? (
                                    <Loader2 className="h-5 w-5 animate-spin" />
                                ) : testStatus === 'success' ? (
                                    "System Active"
                                ) : testStatus === 'error' ? (
                                    "Retry Connection"
                                ) : (
                                    "Identify & Sync"
                                )}
                            </Button>
                        </div>
                    </div>

                    <p className="mt-8 text-center text-[10px] font-bold uppercase tracking-[0.4em] text-slate-300">
                        Zero-Trust Hub
                    </p>
                </div>
            </DialogContent>
        </Dialog>
    );
}
