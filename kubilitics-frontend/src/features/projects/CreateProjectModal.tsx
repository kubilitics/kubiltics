/**
 * Create Project Modal — Entry point for project creation.
 * Options: New Project (guided form) or New Project from YAML (import).
 */
import { useState } from 'react';
import { FolderPlus, FileCode, X } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { CreateProjectForm } from './CreateProjectForm';
import { CreateProjectFromYaml } from './CreateProjectFromYaml';
import { cn } from '@/lib/utils';

type Step = 'choose' | 'basics' | 'clusters' | 'namespaces' | 'review' | 'yaml';

const STEPS = [
  { id: 'basics', label: 'Basics' },
  { id: 'clusters', label: 'Clusters' },
  { id: 'namespaces', label: 'Namespaces' },
  { id: 'review', label: 'Review' },
];

interface CreateProjectModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

export function CreateProjectModal({ open, onOpenChange, onSuccess }: CreateProjectModalProps) {
  const [step, setStep] = useState<Step>('choose');
  const [currentStepIdx, setCurrentStepIdx] = useState(0);

  const handleClose = () => {
    setStep('choose');
    setCurrentStepIdx(0);
    onOpenChange(false);
  };

  const handleSuccess = () => {
    setStep('choose');
    setCurrentStepIdx(0);
    onOpenChange(false);
    onSuccess?.();
  };

  const handleBack = () => {
    if (step === 'basics') setStep('choose');
    else if (step === 'yaml') setStep('choose');
  };

  const isGuided = step !== 'choose' && step !== 'yaml';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          'sm:max-w-lg transition-all duration-500 ease-in-out',
          step !== 'choose' && 'sm:max-w-3xl min-h-[500px]',
          'overflow-hidden border-none bg-background/80 backdrop-blur-xl shadow-2xl'
        )}
      >
        <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-primary/5 pointer-events-none" />

        <DialogHeader className="relative z-10">
          <DialogTitle className="flex items-center gap-3 text-2xl font-bold tracking-tight">
            <div className="p-2 rounded-lg bg-primary/10 text-primary">
              <FolderPlus className="h-6 w-6" />
            </div>
            {step === 'choose' ? 'Create a Project' : step === 'yaml' ? 'Deploy from YAML' : 'New Project Wizard'}
          </DialogTitle>
          <DialogDescription className="text-base">
            {step === 'choose' && (
              "Organize your infrastructure by grouping clusters and namespaces for better multi-cluster management."
            )}
            {isGuided && (
              <div className="mt-6 mb-2">
                <div className="flex justify-between mb-4">
                  {STEPS.map((s, idx) => (
                    <div key={s.id} className="flex flex-col items-center gap-2 flex-1">
                      <div className={cn(
                        "h-2 w-full rounded-full transition-all duration-500",
                        idx <= currentStepIdx ? "bg-primary shadow-[0_0_10px_rgba(var(--primary),0.5)]" : "bg-muted"
                      )} />
                      <span className={cn(
                        "text-[10px] uppercase font-bold tracking-wider",
                        idx <= currentStepIdx ? "text-primary" : "text-muted-foreground/60"
                      )}>{s.label}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="relative z-10 py-2">
          {step === 'choose' && (
            <div className="grid gap-6 py-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <button
                  type="button"
                  onClick={() => setStep('basics')}
                  className="group relative flex flex-col items-center gap-4 p-8 rounded-2xl border border-border bg-card/50 hover:border-primary/50 hover:bg-primary/5 transition-all duration-300 text-center overflow-hidden"
                >
                  <div className="absolute inset-0 bg-gradient-to-br from-primary/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                  <div className="p-4 rounded-2xl bg-primary/10 text-primary group-hover:scale-110 transition-transform duration-300 ring-8 ring-primary/5">
                    <FolderPlus className="h-10 w-10" />
                  </div>
                  <div>
                    <p className="font-bold text-lg">Guided Setup</p>
                    <p className="text-sm text-muted-foreground leading-relaxed mt-1">Create a project step-by-step with our interactive wizard</p>
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => setStep('yaml')}
                  className="group relative flex flex-col items-center gap-4 p-8 rounded-2xl border border-border bg-card/50 hover:border-primary/50 hover:bg-primary/5 transition-all duration-300 text-center overflow-hidden"
                >
                  <div className="absolute inset-0 bg-gradient-to-br from-primary/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                  <div className="p-4 rounded-2xl bg-primary/10 text-primary group-hover:scale-110 transition-transform duration-300 ring-8 ring-primary/5">
                    <FileCode className="h-10 w-10" />
                  </div>
                  <div>
                    <p className="font-bold text-lg">From YAML</p>
                    <p className="text-sm text-muted-foreground leading-relaxed mt-1">Deploy project configuration via declarative YAML manifest</p>
                  </div>
                </button>
              </div>
              <div className="flex justify-center mt-4">
                <Button variant="ghost" onClick={handleClose} className="rounded-full px-8">
                  Dismiss
                </Button>
              </div>
            </div>
          )}

          {isGuided && (
            <CreateProjectForm
              onSuccess={handleSuccess}
              onBack={handleBack}
              onCancel={handleClose}
              onStepChange={setCurrentStepIdx}
            />
          )}

          {step === 'yaml' && (
            <CreateProjectFromYaml onSuccess={handleSuccess} onBack={handleBack} onCancel={handleClose} />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
