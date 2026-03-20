import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  X, 
  ChevronRight, 
  ChevronLeft, 
  Search, 
  Network, 
  Box, 
  LayoutDashboard,
  Sparkles,
  Check
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

interface TourStep {
  id: string;
  title: string;
  description: string;
  icon: React.ElementType;
  target?: string; // CSS selector for highlighting
  position: 'center' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
}

const tourSteps: TourStep[] = [
  {
    id: 'welcome',
    title: 'Welcome to Kubilitics! 🎉',
    description: 'Let us show you around. This quick tour will help you discover the most powerful features of your new Kubernetes operating system.',
    icon: Sparkles,
    position: 'center',
  },
  {
    id: 'dashboard',
    title: 'Your Cluster Dashboard',
    description: 'This is your command center. See real-time health scores, resource usage, pod status, and recent events all in one place.',
    icon: LayoutDashboard,
    target: '[data-tour="dashboard"]',
    position: 'top-left',
  },
  {
    id: 'search',
    title: 'Global Search (⌘K)',
    description: 'Press ⌘K (or Ctrl+K) anytime to instantly search across all your pods, deployments, services, and more. It\'s the fastest way to navigate.',
    icon: Search,
    target: '[data-tour="search"]',
    position: 'top-right',
  },
  {
    id: 'sidebar',
    title: 'Resource Navigation',
    description: 'Browse all 50+ Kubernetes resource types organized by category. Each shows real-time counts from your cluster.',
    icon: Box,
    target: '[data-tour="sidebar"]',
    position: 'top-left',
  },
  {
    id: 'topology',
    title: 'Topology View',
    description: 'Our unique selling point! Visualize your entire cluster as an interactive graph. See relationships between pods, deployments, services, and more.',
    icon: Network,
    position: 'center',
  },
];

interface DashboardTourProps {
  onComplete: () => void;
  onSkip: () => void;
}

export function DashboardTour({ onComplete, onSkip }: DashboardTourProps) {
  const [currentStep, setCurrentStep] = useState(0);
  const [isVisible, setIsVisible] = useState(true);

  const step = tourSteps[currentStep];
  const isFirstStep = currentStep === 0;
  const isLastStep = currentStep === tourSteps.length - 1;
  const progress = ((currentStep + 1) / tourSteps.length) * 100;

  const handleNext = () => {
    if (isLastStep) {
      handleComplete();
    } else {
      setCurrentStep(prev => prev + 1);
    }
  };

  const handlePrev = () => {
    if (!isFirstStep) {
      setCurrentStep(prev => prev - 1);
    }
  };

  const handleComplete = () => {
    setIsVisible(false);
    localStorage.setItem('kubilitics_tour_completed', 'true');
    setTimeout(onComplete, 300);
  };

  const handleSkip = () => {
    setIsVisible(false);
    localStorage.setItem('kubilitics_tour_completed', 'true');
    setTimeout(onSkip, 300);
  };

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleSkip();
      if (e.key === 'ArrowRight') handleNext();
      if (e.key === 'ArrowLeft') handlePrev();
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [currentStep]);

  const StepIcon = step.icon;

  return (
    <AnimatePresence>
      {isVisible && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100]"
            onClick={handleSkip}
          />

          {/* Tour Card */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className={cn(
              "fixed z-[101] w-full max-w-md bg-card border border-border rounded-2xl shadow-2xl overflow-hidden",
              step.position === 'center' && "top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2",
              step.position === 'top-left' && "top-20 left-20",
              step.position === 'top-right' && "top-20 right-20",
              step.position === 'bottom-left' && "bottom-20 left-20",
              step.position === 'bottom-right' && "bottom-20 right-20"
            )}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Progress bar */}
            <div className="h-1 bg-muted">
              <motion.div 
                className="h-full bg-primary"
                initial={{ width: 0 }}
                animate={{ width: `${progress}%` }}
                transition={{ duration: 0.3 }}
              />
            </div>

            {/* Header */}
            <div className="px-6 pt-5 pb-4 flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-xl bg-primary/10">
                  <StepIcon className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <Badge variant="secondary" className="text-[10px] mb-1">
                    Step {currentStep + 1} of {tourSteps.length}
                  </Badge>
                  <h3 className="font-semibold text-lg">{step.title}</h3>
                </div>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 -mr-2 -mt-1"
                onClick={handleSkip}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>

            {/* Content */}
            <div className="px-6 pb-6">
              <p className="text-muted-foreground text-sm leading-relaxed mb-6">
                {step.description}
              </p>

              {/* Step indicators */}
              <div className="flex items-center justify-center gap-1.5 mb-6">
                {tourSteps.map((_, i) => (
                  <button
                    key={i}
                    onClick={() => setCurrentStep(i)}
                    className={cn(
                      "w-2 h-2 rounded-full transition-all",
                      i === currentStep 
                        ? "w-6 bg-primary" 
                        : i < currentStep 
                          ? "bg-primary/50" 
                          : "bg-muted"
                    )}
                  />
                ))}
              </div>

              {/* Actions */}
              <div className="flex items-center justify-between">
                <Button
                  variant="ghost"
                  onClick={handleSkip}
                  className="text-muted-foreground"
                >
                  Skip tour
                </Button>

                <div className="flex items-center gap-2">
                  {!isFirstStep && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handlePrev}
                      className="gap-1"
                    >
                      <ChevronLeft className="h-4 w-4" />
                      Back
                    </Button>
                  )}
                  <Button
                    size="sm"
                    onClick={handleNext}
                    className="gap-1 min-w-[100px]"
                  >
                    {isLastStep ? (
                      <>
                        Get Started
                        <Check className="h-4 w-4" />
                      </>
                    ) : (
                      <>
                        Next
                        <ChevronRight className="h-4 w-4" />
                      </>
                    )}
                  </Button>
                </div>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

// Hook to check if tour should be shown
export function useDashboardTour() {
  const [showTour, setShowTour] = useState(false);

  useEffect(() => {
    const tourCompleted = localStorage.getItem('kubilitics_tour_completed');
    if (!tourCompleted) {
      // Small delay to let the dashboard render first
      const timeout = setTimeout(() => setShowTour(true), 1000);
      return () => clearTimeout(timeout);
    }
  }, []);

  const completeTour = () => setShowTour(false);
  const skipTour = () => setShowTour(false);
  const resetTour = () => {
    localStorage.removeItem('kubilitics_tour_completed');
    setShowTour(true);
  };

  return { showTour, completeTour, skipTour, resetTour };
}
