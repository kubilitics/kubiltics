import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
 Network,
 Brain,
 WifiOff,
 ArrowRight,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useOnboardingStore } from '@/stores/onboardingStore';
import { useClusterStore } from '@/stores/clusterStore';
import { BrandLogo } from '@/components/BrandLogo';

/* ─── Step data ─────────────────────────────────────────────── */

interface FeatureCard {
 icon: React.ElementType;
 title: string;
 description: string;
 gradient: string;
 iconColor: string;
}

const features: FeatureCard[] = [
 {
 icon: Network,
 title: 'Topology Visualization',
 description:
 'See every relationship across 50+ resource types rendered as an interactive, zoomable graph.',
 gradient: 'from-primary/10 via-primary/5 to-transparent',
 iconColor: 'text-primary',
 },
 {
 icon: Brain,
 title: 'AI-Powered Investigation',
 description:
 'Investigate incidents with an AI assistant that understands Kubernetes context and respects safety boundaries.',
 gradient: 'from-[hsl(var(--cosmic-purple))]/10 via-[hsl(var(--cosmic-purple))]/5 to-transparent',
 iconColor: 'text-[hsl(var(--cosmic-purple))]',
 },
 {
 icon: WifiOff,
 title: 'Offline-First Desktop',
 description:
 'Works from your laptop with zero cloud dependency. Your kubeconfig stays local, always.',
 gradient: 'from-[hsl(var(--success))]/10 via-[hsl(var(--success))]/5 to-transparent',
 iconColor: 'text-[hsl(var(--success))]',
 },
];

/* ─── Steps ─────────────────────────────────────────────────── */
// P0-002-T03: Removed 'mode' step — mode is auto-detected now
const steps = ['welcome', 'features'] as const;
type Step = (typeof steps)[number];

/* ─── Shared animation config ────────────────────────────────── */

const ease = [0.23, 1, 0.32, 1] as const;

/* ─── Root component ────────────────────────────────────────── */

export function WelcomeScreen() {
 const [currentStep, setCurrentStep] = useState<Step>('welcome');
 const completeWelcome = useOnboardingStore((s) => s.completeWelcome);
 const setAppMode = useClusterStore((s) => s.setAppMode);

 const stepIndex = steps.indexOf(currentStep);

 // P0-002-T03: Auto-complete onboarding and default to desktop mode.
 // Both Tauri and browser default to 'desktop' (kubeconfig connect flow).
 // The backend will signal 'in-cluster' availability if running inside a pod.
 const handleComplete = () => {
 setAppMode('desktop');
 completeWelcome();
 };

 const handleNext = () => {
 const nextIndex = stepIndex + 1;
 if (nextIndex < steps.length) {
 setCurrentStep(steps[nextIndex]);
 } else {
 handleComplete();
 }
 };

 const handleSkip = () => {
 handleComplete();
 };

 return (
 <div className="fixed inset-0 z-[200] flex items-center justify-center bg-background overflow-hidden">
 {/* Animated background mesh — uses semantic primary tints */}
 <div className="absolute inset-0 pointer-events-none">
 <div
 className="absolute top-[-15%] left-[-10%] w-[60%] h-[60%] bg-primary/[0.06] rounded-full blur-[140px] animate-pulse"
 style={{ animationDuration: '8s' }}
 />
 <div
 className="absolute bottom-[-15%] right-[-10%] w-[60%] h-[60%] bg-[hsl(var(--cosmic-purple))]/[0.06] rounded-full blur-[140px] animate-pulse"
 style={{ animationDuration: '10s', animationDelay: '2s' }}
 />
 <div className="absolute top-[20%] right-[-5%] w-[30%] h-[40%] bg-primary/[0.03] rounded-full blur-[100px]" />
 </div>

 {/* Content */}
 <div className="relative z-10 w-full max-w-3xl px-8">
 <AnimatePresence mode="wait">
 {currentStep === 'welcome' && (
 <WelcomeStep key="welcome" onNext={handleNext} onSkip={handleSkip} />
 )}
 {currentStep === 'features' && (
 <FeaturesStep key="features" onNext={handleComplete} onSkip={handleSkip} />
 )}
 </AnimatePresence>

 {/* Progress dots */}
 <motion.div
 className="flex items-center justify-center gap-2 mt-12"
 initial={{ opacity: 0 }}
 animate={{ opacity: 1 }}
 transition={{ delay: 0.5 }}
 >
 {steps.map((step, i) => (
 <button
 key={step}
 onClick={() => i <= stepIndex && setCurrentStep(steps[i])}
 className={cn(
 'h-2 rounded-full transition-all duration-300',
 i === stepIndex
 ? 'w-8 bg-primary'
 : i < stepIndex
 ? 'w-2 bg-primary/50 cursor-pointer hover:bg-primary/70'
 : 'w-2 bg-muted-foreground/20'
 )}
 aria-label={`Go to step ${i + 1}`}
 />
 ))}
 </motion.div>
 </div>
 </div>
 );
}

/* ─── Step 1: Welcome ───────────────────────────────────────── */

function WelcomeStep({
 onNext,
 onSkip,
}: {
 onNext: () => void;
 onSkip: () => void;
}) {
 return (
 <motion.div
 initial={{ opacity: 0, y: 20 }}
 animate={{ opacity: 1, y: 0 }}
 exit={{ opacity: 0, y: -20 }}
 transition={{ duration: 0.4, ease }}
 className="text-center"
 >
 <motion.div
 initial={{ scale: 0.5, opacity: 0 }}
 animate={{ scale: 1, opacity: 1 }}
 transition={{ duration: 0.6, ease }}
 className="mb-8 flex justify-center"
 >
 <BrandLogo mark height={96} className="drop-shadow-[0_20px_40px_hsl(var(--primary)/0.3)]" />
 </motion.div>

 <motion.h1
 initial={{ opacity: 0, y: 10 }}
 animate={{ opacity: 1, y: 0 }}
 transition={{ delay: 0.2, duration: 0.4 }}
 className="text-5xl font-bold tracking-tighter text-foreground mb-4"
 >
 Kubilitics
 </motion.h1>

 <motion.p
 initial={{ opacity: 0, y: 10 }}
 animate={{ opacity: 1, y: 0 }}
 transition={{ delay: 0.3, duration: 0.4 }}
 className="text-xl text-muted-foreground font-medium mb-2"
 >
 Kubernetes, Made Human
 </motion.p>

 <motion.p
 initial={{ opacity: 0, y: 10 }}
 animate={{ opacity: 1, y: 0 }}
 transition={{ delay: 0.4, duration: 0.4 }}
 className="text-sm text-muted-foreground/70 mb-12 max-w-md mx-auto leading-relaxed"
 >
 The AI-powered Kubernetes operating system with topology visualization,
 intelligent investigation, and offline-first desktop experience.
 </motion.p>

 <motion.div
 initial={{ opacity: 0, y: 10 }}
 animate={{ opacity: 1, y: 0 }}
 transition={{ delay: 0.5, duration: 0.4 }}
 className="flex items-center justify-center gap-4"
 >
 <Button
 variant="ghost"
 onClick={onSkip}
 className="text-muted-foreground hover:text-foreground"
 >
 Skip
 </Button>
 <Button
 size="lg"
 onClick={onNext}
 className="gap-2 px-8 bg-primary hover:bg-primary/90 text-primary-foreground rounded-2xl h-12 font-semibold shadow-lg shadow-primary/20"
 >
 Get Started
 <ArrowRight className="h-4 w-4" />
 </Button>
 </motion.div>
 </motion.div>
 );
}

/* ─── Step 2: Features ──────────────────────────────────────── */

function FeaturesStep({
 onNext,
 onSkip,
}: {
 onNext: () => void;
 onSkip: () => void;
}) {
 return (
 <motion.div
 initial={{ opacity: 0, y: 20 }}
 animate={{ opacity: 1, y: 0 }}
 exit={{ opacity: 0, y: -20 }}
 transition={{ duration: 0.4, ease }}
 >
 <div className="text-center mb-10">
 <h2 className="text-3xl font-bold tracking-tight text-foreground mb-3">
 What makes Kubilitics different
 </h2>
 <p className="text-muted-foreground font-medium">
 Three pillars that set us apart from every other Kubernetes tool.
 </p>
 </div>

 <div className="grid gap-4">
 {features.map((feature, i) => (
 <motion.div
 key={feature.title}
 initial={{ opacity: 0, x: -20 }}
 animate={{ opacity: 1, x: 0 }}
 transition={{
 delay: 0.15 * i,
 duration: 0.4,
 ease,
 }}
 className={cn(
 'flex items-start gap-4 p-5 rounded-2xl border border-border bg-card/50',
 'hover:bg-card hover:border-border/80 hover:shadow-sm transition-all duration-300'
 )}
 >
 <div
 className={cn(
 'p-3 rounded-xl bg-gradient-to-br shrink-0',
 feature.gradient
 )}
 >
 <feature.icon className={cn('h-6 w-6', feature.iconColor)} />
 </div>
 <div>
 <h3 className="font-semibold text-foreground mb-1">{feature.title}</h3>
 <p className="text-sm text-muted-foreground leading-relaxed">
 {feature.description}
 </p>
 </div>
 </motion.div>
 ))}
 </div>

 <motion.div
 initial={{ opacity: 0 }}
 animate={{ opacity: 1 }}
 transition={{ delay: 0.6 }}
 className="flex items-center justify-center gap-4 mt-10"
 >
 <Button
 variant="ghost"
 onClick={onSkip}
 className="text-muted-foreground hover:text-foreground"
 >
 Skip
 </Button>
 <Button
 size="lg"
 onClick={onNext}
 className="gap-2 px-8 bg-primary hover:bg-primary/90 text-primary-foreground rounded-2xl h-12 font-semibold shadow-lg shadow-primary/20"
 >
 Connect My Cluster
 <ArrowRight className="h-4 w-4" />
 </Button>
 </motion.div>
 </motion.div>
 );
}
