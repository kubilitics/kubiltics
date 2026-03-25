import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronLeft, ChevronRight, Check, X, Code, Eye, AlertCircle, Copy, Download, Maximize2, Minimize2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Textarea } from '@/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { toast } from '@/components/ui/sonner';

export interface WizardStep {
  id: string;
  title: string;
  description: string;
  content: React.ReactNode;
  isValid?: boolean;
}

interface ResourceWizardProps {
  title: string;
  resourceType: string;
  steps: WizardStep[];
  yaml: string;
  onClose: () => void;
  onSubmit: (yaml?: string) => void;
  onYamlChange?: (yaml: string) => void;
  isSubmitting?: boolean;
}

interface YamlValidationResult {
  isValid: boolean;
  errors: string[];
}

function validateYaml(yaml: string): YamlValidationResult {
  const errors: string[] = [];
  
  if (!yaml.trim()) {
    errors.push('YAML cannot be empty');
    return { isValid: false, errors };
  }

  // Check for required fields
  if (!yaml.includes('apiVersion:')) {
    errors.push('Missing required field: apiVersion');
  }
  if (!yaml.includes('kind:')) {
    errors.push('Missing required field: kind');
  }
  if (!yaml.includes('metadata:')) {
    errors.push('Missing required field: metadata');
  }
  if (!yaml.includes('name:')) {
    errors.push('Missing required field: metadata.name');
  }

  // Check for basic YAML syntax
  const lines = yaml.split('\n');
  lines.forEach((line, index) => {
    if (line.trim() && !line.startsWith('#')) {
      // Check for tabs (YAML should use spaces)
      if (line.includes('\t')) {
        errors.push(`Line ${index + 1}: Tabs are not allowed in YAML, use spaces`);
      }
      // Check for inconsistent indentation patterns
      const leadingSpaces = line.match(/^(\s*)/)?.[1]?.length || 0;
      if (leadingSpaces % 2 !== 0 && line.trim()) {
        errors.push(`Line ${index + 1}: Indentation should be multiples of 2 spaces`);
      }
    }
  });

  return { isValid: errors.length === 0, errors: errors.slice(0, 5) };
}

export function ResourceWizard({
  title,
  resourceType,
  steps,
  yaml,
  onClose,
  onSubmit,
  onYamlChange,
  isSubmitting = false,
}: ResourceWizardProps) {
  const [currentStep, setCurrentStep] = useState(0);
  const [previewMode, setPreviewMode] = useState<'form' | 'yaml'>('form');
  const [editedYaml, setEditedYaml] = useState(yaml);
  const [yamlValidation, setYamlValidation] = useState<YamlValidationResult>({ isValid: true, errors: [] });
  const [isYamlExpanded, setIsYamlExpanded] = useState(false);

  // Sync editedYaml when yaml prop changes (from form updates)
  useEffect(() => {
    if (previewMode === 'form') {
      setEditedYaml(yaml);
    }
  }, [yaml, previewMode]);

  // Validate YAML on change
  useEffect(() => {
    if (previewMode === 'yaml') {
      const result = validateYaml(editedYaml);
      setYamlValidation(result);
    }
  }, [editedYaml, previewMode]);

  const isLastStep = currentStep === steps.length - 1;
  const canProceed = steps[currentStep]?.isValid !== false;
  const canSubmit = previewMode === 'yaml' ? yamlValidation.isValid : canProceed;

  const handleNext = () => {
    if (!isLastStep && canProceed) {
      setCurrentStep((prev) => prev + 1);
    }
  };

  const handlePrev = () => {
    if (currentStep > 0) {
      setCurrentStep((prev) => prev - 1);
    }
  };

  const handleYamlChange = (value: string) => {
    setEditedYaml(value);
    onYamlChange?.(value);
  };

  const handleCopyYaml = () => {
    navigator.clipboard.writeText(editedYaml);
    toast.success('YAML copied to clipboard');
  };

  const handleDownloadYaml = () => {
    const blob = new Blob([editedYaml], { type: 'text/yaml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${resourceType.toLowerCase()}.yaml`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
    toast.success('YAML downloaded');
  };

  const handleSubmit = () => {
    if (previewMode === 'yaml') {
      onSubmit(editedYaml);
    } else {
      onSubmit();
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="absolute inset-0 z-40 flex flex-col bg-white dark:bg-slate-900 overflow-hidden"
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        className="flex-1 flex flex-col bg-white dark:bg-slate-900 overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200/60 dark:border-slate-700/60 bg-gradient-to-b from-slate-50/80 to-white dark:from-slate-800/80 dark:to-slate-900">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-xl bg-primary/10 dark:bg-primary/20 flex items-center justify-center">
              <Code className="h-4 w-4 text-primary" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">{title}</h2>
              <p className="text-xs text-muted-foreground">
                <span className="font-mono font-medium text-slate-600 dark:text-slate-300">{resourceType}</span>
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1 bg-slate-100/80 dark:bg-slate-800/80 rounded-lg p-0.5">
              <button
                onClick={() => setPreviewMode('form')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                  previewMode === 'form'
                    ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 shadow-sm'
                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'
                }`}
              >
                <Eye className="h-3.5 w-3.5" />
                Form
              </button>
              <button
                onClick={() => setPreviewMode('yaml')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                  previewMode === 'yaml'
                    ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 shadow-sm'
                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'
                }`}
              >
                <Code className="h-3.5 w-3.5" />
                YAML
              </button>
            </div>
            <button
              onClick={onClose}
              className="h-8 w-8 rounded-lg flex items-center justify-center text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Progress Steps */}
        <div className="px-6 py-3 border-b bg-muted/20">
          <div className="flex items-center gap-2">
            {steps.map((step, index) => (
              <div key={step.id} className="flex items-center gap-2">
                <button
                  onClick={() => index <= currentStep && setCurrentStep(index)}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                    index === currentStep
                      ? 'bg-primary text-primary-foreground'
                      : index < currentStep
                      ? 'bg-primary/20 text-primary cursor-pointer hover:bg-primary/30'
                      : 'bg-muted text-muted-foreground'
                  }`}
                >
                  {index < currentStep ? (
                    <Check className="h-3 w-3" />
                  ) : (
                    <span>{index + 1}</span>
                  )}
                  {step.title}
                </button>
                {index < steps.length - 1 && (
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-hidden">
          {previewMode === 'form' ? (
            <ScrollArea className="h-full">
              <div className="p-6">
                <AnimatePresence mode="wait">
                  <motion.div
                    key={currentStep}
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -20 }}
                    transition={{ duration: 0.2 }}
                  >
                    <div className="mb-4">
                      <h3 className="text-base font-medium">{steps[currentStep].title}</h3>
                      <p className="text-sm text-muted-foreground">
                        {steps[currentStep].description}
                      </p>
                    </div>
                    {steps[currentStep].content}
                  </motion.div>
                </AnimatePresence>
              </div>
            </ScrollArea>
          ) : (
            <div className="h-full flex flex-col">
              <div className="flex items-center justify-between px-6 py-2 border-b bg-muted/10">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">Edit YAML</span>
                  {!yamlValidation.isValid && (
                    <Badge variant="destructive" className="text-xs gap-1">
                      <AlertCircle className="h-3 w-3" />
                      {yamlValidation.errors.length} error{yamlValidation.errors.length !== 1 ? 's' : ''}
                    </Badge>
                  )}
                  {yamlValidation.isValid && editedYaml.trim() && (
                    <Badge variant="outline" className="text-xs text-emerald-600">
                      Valid
                    </Badge>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  <Button variant="ghost" size="sm" className="h-7 gap-1.5" onClick={handleCopyYaml}>
                    <Copy className="h-3.5 w-3.5" />
                    Copy
                  </Button>
                  <Button variant="ghost" size="sm" className="h-7 gap-1.5" onClick={handleDownloadYaml}>
                    <Download className="h-3.5 w-3.5" />
                    Download
                  </Button>
                  <div className="w-px h-4 bg-border mx-1" />
                  <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 p-0"
                          onClick={() => setIsYamlExpanded(!isYamlExpanded)}
                        >
                          {isYamlExpanded ? (
                            <Minimize2 className="h-3.5 w-3.5" />
                          ) : (
                            <Maximize2 className="h-3.5 w-3.5" />
                          )}
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>
                        {isYamlExpanded ? 'Exit fullscreen' : 'Expand editor'}
                      </TooltipContent>
                    </Tooltip>
                </div>
              </div>
              <div className="flex-1 p-4 overflow-hidden">
                <Textarea
                  value={editedYaml}
                  onChange={(e) => handleYamlChange(e.target.value)}
                  className={`h-full font-mono text-sm resize-none bg-muted/30 border-muted ${
                    isYamlExpanded ? 'text-base leading-relaxed' : ''
                  }`}
                  placeholder="Enter YAML configuration..."
                  spellCheck={false}
                />
              </div>
              {!yamlValidation.isValid && (
                <div className="px-6 py-3 border-t bg-destructive/5">
                  <div className="flex items-start gap-2">
                    <AlertCircle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
                    <div className="space-y-1">
                      {yamlValidation.errors.map((error, i) => (
                        <p key={i} className="text-xs text-destructive">{error}</p>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-slate-200/60 dark:border-slate-700/60 bg-slate-50/80 dark:bg-slate-800/50">
          <button
            onClick={currentStep === 0 || previewMode === 'yaml' ? onClose : handlePrev}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <ChevronLeft className="h-4 w-4" />
            {currentStep === 0 || previewMode === 'yaml' ? 'Cancel' : 'Previous'}
          </button>
          {isLastStep || previewMode === 'yaml' ? (
            <button
              onClick={handleSubmit}
              disabled={!canSubmit || isSubmitting}
              className={`flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm font-semibold transition-all shadow-sm ${
                canSubmit && !isSubmitting
                  ? 'bg-primary text-primary-foreground hover:bg-primary/90 shadow-primary/25 hover:shadow-md hover:shadow-primary/20'
                  : 'bg-slate-200 dark:bg-slate-700 text-slate-400 dark:text-slate-500 cursor-not-allowed shadow-none'
              }`}
            >
              {isSubmitting ? (
                <>Creating...</>
              ) : (
                <>
                  <Check className="h-4 w-4" />
                  Create Resource
                </>
              )}
            </button>
          ) : (
            <button
              onClick={handleNext}
              disabled={!canProceed}
              className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold transition-all shadow-sm ${
                canProceed
                  ? 'bg-primary text-primary-foreground hover:bg-primary/90 shadow-primary/25'
                  : 'bg-slate-200 dark:bg-slate-700 text-slate-400 dark:text-slate-500 cursor-not-allowed shadow-none'
              }`}
            >
              Next
              <ChevronRight className="h-4 w-4" />
            </button>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}
