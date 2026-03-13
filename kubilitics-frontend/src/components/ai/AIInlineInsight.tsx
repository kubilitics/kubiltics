/**
 * AIInlineInsight — Shows a subtle AI hypothesis card when a resource
 * is in an error state (CrashLoopBackOff, OOMKilled, ImagePullBackOff, etc.).
 * Clicking expands the AI investigation panel.
 */
import { useState } from 'react';
import { Sparkles, ChevronRight, X } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAIStatus } from '@/hooks/useAIStatus';
import { cn } from '@/lib/utils';

interface AIInlineInsightProps {
 /** The error status/reason (e.g. 'CrashLoopBackOff', 'OOMKilled') */
 errorReason: string;
 /** Resource kind for context */
 resourceKind: string;
 /** Resource name for context */
 resourceName: string;
 /** Resource namespace */
 namespace?: string;
 /** Custom className */
 className?: string;
}

/** Map common Kubernetes error reasons to quick AI hypotheses */
const ERROR_HYPOTHESES: Record<string, string> = {
 CrashLoopBackOff: 'The container keeps crashing and restarting. Common causes: missing env vars, incorrect entrypoint, or dependency failures.',
 OOMKilled: 'The container exceeded its memory limit. Consider increasing memory requests/limits or investigating memory leaks.',
 ImagePullBackOff: 'Unable to pull the container image. Check image name, tag, and registry credentials.',
 ErrImagePull: 'Failed to pull the container image. Verify the image exists and pull secrets are configured.',
 CreateContainerConfigError: 'Container configuration error. Check ConfigMap/Secret references and volume mounts.',
 RunContainerError: 'Failed to start the container. Check security context, capabilities, and runtime constraints.',
 Pending: 'Pod is waiting to be scheduled. Possible causes: insufficient resources, node affinity, or taints.',
 Evicted: 'Pod was evicted due to resource pressure on the node. Check node resource usage.',
 Failed: 'Pod execution failed. Check container logs and events for details.',
 Unknown: 'Pod status is unknown. The node may be unreachable.',
};

export function AIInlineInsight({
 errorReason,
 resourceKind,
 resourceName,
 namespace,
 className,
}: AIInlineInsightProps) {
 const [dismissed, setDismissed] = useState(false);
 const aiStatus = useAIStatus();

 // Only show for active AI and known error reasons
 if (aiStatus.status !== 'active' || dismissed) return null;

 const hypothesis = ERROR_HYPOTHESES[errorReason];
 if (!hypothesis) return null;

 const handleInvestigate = () => {
 window.dispatchEvent(
 new CustomEvent('kubilitics:ai-investigate', {
 detail: {
 prompt: `Investigate why ${resourceKind} "${resourceName}"${namespace ? ` in namespace "${namespace}"` : ''} is in ${errorReason} state. Provide root cause analysis and remediation steps.`,
 resourceKind,
 resourceName,
 namespace,
 },
 })
 );
 };

 return (
 <AnimatePresence>
 <motion.div
 initial={{ opacity: 0, height: 0 }}
 animate={{ opacity: 1, height: 'auto' }}
 exit={{ opacity: 0, height: 0 }}
 className={cn('overflow-hidden', className)}
 >
 <div className="flex items-start gap-3 p-3 rounded-xl border border-primary/20 bg-primary/5">
 <div className="p-1.5 rounded-lg bg-primary/10 shrink-0 mt-0.5">
 <Sparkles className="h-3.5 w-3.5 text-primary" />
 </div>
 <div className="flex-1 min-w-0">
 <p className="text-xs font-medium text-foreground mb-0.5">AI Insight</p>
 <p className="text-xs text-muted-foreground leading-relaxed">{hypothesis}</p>
 <button
 onClick={handleInvestigate}
 className="inline-flex items-center gap-1 mt-2 text-xs font-medium text-primary hover:text-primary/80 transition-colors"
 >
 Investigate with AI
 <ChevronRight className="h-3 w-3" />
 </button>
 </div>
 <button
 onClick={() => setDismissed(true)}
 className="p-1 rounded-md hover:bg-muted transition-colors shrink-0"
 aria-label="Dismiss insight"
 >
 <X className="h-3.5 w-3.5 text-muted-foreground" />
 </button>
 </div>
 </motion.div>
 </AnimatePresence>
 );
}
