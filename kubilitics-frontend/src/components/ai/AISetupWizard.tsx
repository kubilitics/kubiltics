/**
 * AISetupWizard — Simplified 2-step AI provider setup
 *
 * TASK-AI-003: AI Setup Simplification
 * Reduces AI setup from 5 steps to 2: select provider → enter API key.
 */

import { useState, useCallback, useEffect } from 'react';
import { cn } from '@/lib/utils';
import {
  Bot,
  Check,
  Loader2,
  AlertCircle,
  ExternalLink,
  Sparkles,
  Server,
  Cloud,
  Cpu,
  Settings,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

// ─── Types ───────────────────────────────────────────────────────────────────

export type AIProvider = 'openai' | 'anthropic' | 'ollama' | 'custom';

type SetupStep = 'provider' | 'configure';
type ValidationStatus = 'idle' | 'validating' | 'success' | 'error';

interface ProviderConfig {
  id: AIProvider;
  name: string;
  description: string;
  icon: React.ElementType;
  color: string;
  darkColor: string;
  placeholder: string;
  helpText: string;
  docsUrl: string;
  /** Whether this provider needs a URL instead of API key */
  usesUrl?: boolean;
  /** Default URL for auto-detection */
  defaultUrl?: string;
}

// ─── Provider Definitions ────────────────────────────────────────────────────

const PROVIDERS: ProviderConfig[] = [
  {
    id: 'openai',
    name: 'OpenAI',
    description: 'GPT-4o, GPT-4 Turbo',
    icon: Cloud,
    color: 'bg-emerald-50 border-emerald-200 text-emerald-700',
    darkColor: 'dark:bg-emerald-950/30 dark:border-emerald-800/40 dark:text-emerald-400',
    placeholder: 'sk-...',
    helpText: 'Enter your OpenAI API key',
    docsUrl: 'https://platform.openai.com/api-keys',
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    description: 'Claude 4, Claude 3.5 Sonnet',
    icon: Bot,
    color: 'bg-orange-50 border-orange-200 text-orange-700',
    darkColor: 'dark:bg-orange-950/30 dark:border-orange-800/40 dark:text-orange-400',
    placeholder: 'sk-ant-...',
    helpText: 'Enter your Anthropic API key',
    docsUrl: 'https://console.anthropic.com/settings/keys',
  },
  {
    id: 'ollama',
    name: 'Ollama',
    description: 'Local models (Llama, Mistral)',
    icon: Cpu,
    color: 'bg-blue-50 border-blue-200 text-blue-700',
    darkColor: 'dark:bg-blue-950/30 dark:border-blue-800/40 dark:text-blue-400',
    placeholder: 'http://localhost:11434',
    helpText: 'Ollama endpoint URL',
    docsUrl: 'https://ollama.com',
    usesUrl: true,
    defaultUrl: 'http://localhost:11434',
  },
  {
    id: 'custom',
    name: 'Custom',
    description: 'OpenAI-compatible API',
    icon: Settings,
    color: 'bg-slate-50 border-slate-200 text-slate-700',
    darkColor: 'dark:bg-slate-800/30 dark:border-slate-700/40 dark:text-slate-400',
    placeholder: 'https://api.example.com/v1',
    helpText: 'Enter your API endpoint URL and key',
    docsUrl: '',
    usesUrl: true,
  },
];

// ─── Validation ──────────────────────────────────────────────────────────────

async function validateProvider(
  provider: AIProvider,
  value: string,
  url?: string
): Promise<{ success: boolean; error?: string }> {
  try {
    // For Ollama, try to connect to the endpoint
    if (provider === 'ollama') {
      const response = await fetch(`${value}/api/tags`, {
        method: 'GET',
        signal: AbortSignal.timeout(5000),
      });
      if (response.ok) return { success: true };
      return { success: false, error: 'Could not connect to Ollama' };
    }

    // For API key providers, make a test call to our backend
    const response = await fetch('/api/v1/ai/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider,
        api_key: value,
        endpoint: url,
      }),
    });

    if (response.ok) return { success: true };

    const data = await response.json().catch(() => null);
    return {
      success: false,
      error: data?.error || `Validation failed (${response.status})`,
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Connection failed',
    };
  }
}

// ─── Provider Card ───────────────────────────────────────────────────────────

function ProviderCard({
  provider,
  isSelected,
  onSelect,
}: {
  provider: ProviderConfig;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const Icon = provider.icon;

  return (
    <button
      onClick={onSelect}
      className={cn(
        'relative flex flex-col items-center gap-3 p-5 rounded-xl border-2 transition-all duration-200',
        'hover:shadow-md dark:hover:shadow-slate-950/30',
        'focus:outline-none focus:ring-2 focus:ring-primary/30',
        isSelected
          ? 'border-primary bg-primary/5 dark:bg-primary/10 shadow-md'
          : cn('border-slate-200 dark:border-slate-700 hover:border-primary/40', provider.color, provider.darkColor, 'bg-opacity-30 dark:bg-opacity-20')
      )}
    >
      {isSelected && (
        <div className="absolute top-2 right-2 p-1 rounded-full bg-primary text-primary-foreground">
          <Check className="h-3 w-3" />
        </div>
      )}
      <div className={cn(
        'p-3 rounded-xl',
        isSelected ? 'bg-primary/10 dark:bg-primary/20' : 'bg-slate-100 dark:bg-slate-800'
      )}>
        <Icon className={cn('h-6 w-6', isSelected ? 'text-primary' : 'text-slate-600 dark:text-slate-400')} />
      </div>
      <div className="text-center">
        <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">{provider.name}</p>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{provider.description}</p>
      </div>
    </button>
  );
}

// ─── Main Wizard Component ───────────────────────────────────────────────────

export interface AISetupWizardProps {
  /** Callback when setup is complete */
  onComplete?: (provider: AIProvider, config: { apiKey?: string; endpoint?: string }) => void;
  /** Callback to cancel setup */
  onCancel?: () => void;
  /** Show as inline card (vs full page) */
  inline?: boolean;
  /** Additional className */
  className?: string;
}

/**
 * AISetupWizard — 2-step AI provider configuration.
 *
 * Step 1: Select provider (visual card grid)
 * Step 2: Enter API key / URL with inline validation
 *
 * @example
 * <AISetupWizard onComplete={(provider, config) => saveAIConfig(provider, config)} />
 */
export function AISetupWizard({
  onComplete,
  onCancel,
  inline = false,
  className,
}: AISetupWizardProps) {
  const [step, setStep] = useState<SetupStep>('provider');
  const [selectedProvider, setSelectedProvider] = useState<AIProvider | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [endpoint, setEndpoint] = useState('');
  const [validationStatus, setValidationStatus] = useState<ValidationStatus>('idle');
  const [validationError, setValidationError] = useState('');

  const providerConfig = PROVIDERS.find((p) => p.id === selectedProvider);

  // Auto-populate Ollama default URL
  useEffect(() => {
    if (selectedProvider === 'ollama' && providerConfig?.defaultUrl && !endpoint) {
      setEndpoint(providerConfig.defaultUrl);
    }
  }, [selectedProvider, providerConfig, endpoint]);

  const handleProviderSelect = useCallback((provider: AIProvider) => {
    setSelectedProvider(provider);
    setStep('configure');
    setApiKey('');
    setEndpoint('');
    setValidationStatus('idle');
    setValidationError('');
  }, []);

  const handleValidate = useCallback(async () => {
    if (!selectedProvider || !providerConfig) return;

    setValidationStatus('validating');
    setValidationError('');

    const value = providerConfig.usesUrl ? (endpoint || providerConfig.defaultUrl || '') : apiKey;

    if (!value) {
      setValidationStatus('error');
      setValidationError(providerConfig.usesUrl ? 'Please enter a URL' : 'Please enter an API key');
      return;
    }

    const result = await validateProvider(
      selectedProvider,
      value,
      providerConfig.usesUrl ? undefined : endpoint
    );

    if (result.success) {
      setValidationStatus('success');
      // Auto-complete after 1 second
      setTimeout(() => {
        onComplete?.(selectedProvider, {
          apiKey: providerConfig.usesUrl ? undefined : apiKey,
          endpoint: providerConfig.usesUrl ? value : endpoint || undefined,
        });
      }, 1000);
    } else {
      setValidationStatus('error');
      setValidationError(result.error || 'Validation failed');
    }
  }, [selectedProvider, providerConfig, apiKey, endpoint, onComplete]);

  return (
    <div className={cn(
      inline ? 'p-0' : 'max-w-lg mx-auto',
      className
    )}>
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <div className="p-2 rounded-xl bg-gradient-to-br from-violet-500/10 to-blue-500/10 dark:from-violet-500/20 dark:to-blue-500/20">
          <Sparkles className="h-5 w-5 text-violet-600 dark:text-violet-400" />
        </div>
        <div>
          <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Set Up AI</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {step === 'provider' ? 'Choose your AI provider' : `Configure ${providerConfig?.name}`}
          </p>
        </div>
      </div>

      {/* Step Indicator */}
      <div className="flex items-center gap-2 mb-6">
        <div className={cn(
          'flex items-center gap-1.5 text-xs font-semibold',
          step === 'provider' ? 'text-primary' : 'text-emerald-600 dark:text-emerald-400'
        )}>
          {step !== 'provider' ? <Check className="h-3.5 w-3.5" /> : <span className="w-5 h-5 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-[10px]">1</span>}
          Provider
        </div>
        <div className="h-px flex-1 bg-slate-200 dark:bg-slate-700" />
        <div className={cn(
          'flex items-center gap-1.5 text-xs font-semibold',
          step === 'configure' ? 'text-primary' : 'text-slate-400 dark:text-slate-500'
        )}>
          <span className={cn(
            'w-5 h-5 rounded-full flex items-center justify-center text-[10px]',
            step === 'configure' ? 'bg-primary text-primary-foreground' : 'bg-slate-200 dark:bg-slate-700 text-slate-500 dark:text-slate-400'
          )}>2</span>
          Configure
        </div>
      </div>

      <AnimatePresence mode="wait">
        {/* Step 1: Provider Selection */}
        {step === 'provider' && (
          <motion.div
            key="provider"
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.2 }}
          >
            <div className="grid grid-cols-2 gap-3">
              {PROVIDERS.map((provider) => (
                <ProviderCard
                  key={provider.id}
                  provider={provider}
                  isSelected={selectedProvider === provider.id}
                  onSelect={() => handleProviderSelect(provider.id)}
                />
              ))}
            </div>
          </motion.div>
        )}

        {/* Step 2: Configuration */}
        {step === 'configure' && providerConfig && (
          <motion.div
            key="configure"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 20 }}
            transition={{ duration: 0.2 }}
            className="space-y-4"
          >
            <button
              onClick={() => setStep('provider')}
              className="text-xs text-primary hover:text-primary/80 font-medium"
            >
              &larr; Change provider
            </button>

            {/* API Key / URL Input */}
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                {providerConfig.usesUrl ? 'Endpoint URL' : 'API Key'}
              </label>
              <input
                type={providerConfig.usesUrl ? 'url' : 'password'}
                value={providerConfig.usesUrl ? endpoint : apiKey}
                onChange={(e) => providerConfig.usesUrl ? setEndpoint(e.target.value) : setApiKey(e.target.value)}
                placeholder={providerConfig.placeholder}
                className={cn(
                  'w-full px-4 py-3 rounded-xl text-sm font-mono',
                  'bg-slate-50 dark:bg-slate-800 border',
                  validationStatus === 'success'
                    ? 'border-emerald-300 dark:border-emerald-700'
                    : validationStatus === 'error'
                      ? 'border-red-300 dark:border-red-700'
                      : 'border-slate-200 dark:border-slate-700',
                  'text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500',
                  'focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/40'
                )}
                autoFocus
              />
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1.5">
                {providerConfig.helpText}
                {providerConfig.docsUrl && (
                  <>
                    {' · '}
                    <a
                      href={providerConfig.docsUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary hover:text-primary/80 inline-flex items-center gap-0.5"
                    >
                      Get key <ExternalLink className="h-3 w-3" />
                    </a>
                  </>
                )}
              </p>
            </div>

            {/* Validation Status */}
            <AnimatePresence>
              {validationStatus === 'success' && (
                <motion.div
                  initial={{ opacity: 0, y: -5 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/40"
                >
                  <Check className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                  <span className="text-sm font-medium text-emerald-700 dark:text-emerald-400">
                    Ready
                  </span>
                </motion.div>
              )}
              {validationStatus === 'error' && validationError && (
                <motion.div
                  initial={{ opacity: 0, y: -5 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800/40"
                >
                  <AlertCircle className="h-4 w-4 text-red-600 dark:text-red-400" />
                  <span className="text-sm text-red-700 dark:text-red-400">{validationError}</span>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Actions */}
            <div className="flex items-center gap-3 pt-2">
              <button
                onClick={handleValidate}
                disabled={validationStatus === 'validating' || validationStatus === 'success'}
                className={cn(
                  'flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium',
                  'bg-primary text-primary-foreground hover:bg-primary/90',
                  'disabled:opacity-50 disabled:cursor-not-allowed',
                  'transition-colors duration-200'
                )}
              >
                {validationStatus === 'validating' ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Validating...
                  </>
                ) : validationStatus === 'success' ? (
                  <>
                    <Check className="h-4 w-4" />
                    Connected!
                  </>
                ) : (
                  <>
                    <Sparkles className="h-4 w-4" />
                    Connect
                  </>
                )}
              </button>
              {onCancel && (
                <button
                  onClick={onCancel}
                  className="px-4 py-2.5 rounded-xl text-sm font-medium text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                >
                  Cancel
                </button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
