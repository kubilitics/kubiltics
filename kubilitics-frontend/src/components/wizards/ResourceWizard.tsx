import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronLeft, ChevronRight, Check, X, Code, Eye, AlertCircle, Copy, Download, Maximize2, Minimize2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Textarea } from '@/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { toast } from 'sonner';

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
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm p-4"
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        className={`flex flex-col bg-background border rounded-xl shadow-2xl overflow-hidden transition-all duration-300 ${
          isYamlExpanded 
            ? 'fixed inset-4 z-50 max-w-none max-h-none' 
            : 'w-full max-w-4xl max-h-[90vh]'
        }`}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b bg-muted/30">
          <div className="flex items-center gap-3">
            <Badge variant="outline" className="font-mono text-xs">
              {resourceType}
            </Badge>
            <h2 className="text-lg font-semibold">{title}</h2>
          </div>
          <div className="flex items-center gap-2">
            <Tabs value={previewMode} onValueChange={(v) => setPreviewMode(v as 'form' | 'yaml')}>
              <TabsList className="h-8">
                <TabsTrigger value="form" className="text-xs gap-1.5 h-7">
                  <Eye className="h-3.5 w-3.5" />
                  Form
                </TabsTrigger>
                <TabsTrigger value="yaml" className="text-xs gap-1.5 h-7">
                  <Code className="h-3.5 w-3.5" />
                  YAML
                </TabsTrigger>
              </TabsList>
            </Tabs>
            <Button variant="ghost" size="icon" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
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
                    <Badge variant="outline" className="text-xs text-[hsl(142,76%,36%)]">
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
                  <TooltipProvider delayDuration={200}>
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
                  </TooltipProvider>
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
        <div className="flex items-center justify-between px-6 py-4 border-t bg-muted/30">
          <Button
            variant="outline"
            onClick={handlePrev}
            disabled={currentStep === 0 || previewMode === 'yaml'}
            className="gap-1.5"
          >
            <ChevronLeft className="h-4 w-4" />
            Previous
          </Button>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            {isLastStep || previewMode === 'yaml' ? (
              <Button onClick={handleSubmit} disabled={!canSubmit || isSubmitting}>
                {isSubmitting ? 'Creating...' : 'Create Resource'}
              </Button>
            ) : (
              <Button onClick={handleNext} disabled={!canProceed} className="gap-1.5">
                Next
                <ChevronRight className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}
