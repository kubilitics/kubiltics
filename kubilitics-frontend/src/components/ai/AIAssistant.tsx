import { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Bot,
  Send,
  X,
  Sparkles,
  Maximize2,
  Minimize2,
  Copy,
  CheckCircle,
  Loader2,
  Terminal,
  Eye,
  Scale,
  Wifi,
  Trash2,
  Wrench,
  AlertCircle,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Search,
  Activity,
  Shield,
  DollarSign,
  Zap,
  Settings2,
  Box,
  Server,
  Network,
  HardDrive,
  Lock,
  LayoutDashboard,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { useWebSocket, type ToolEvent } from '@/hooks/useWebSocket';
import { buildChatWSUrl } from '@/services/aiService';
import { useLocation } from 'react-router-dom';
import { useAIPanelStore, type AIContext } from '@/stores/aiPanelStore';

// ─── Route context ─────────────────────────────────────────────────────────────

interface RouteContext {
  namespace: string;
  resource: string;
  screen: string;
  resourceName: string;
  resourceKind: string;
}

/** Extract namespace / resource type / resource name / screen from current URL */
function useRouteContext() {
  const location = useLocation();
  return useCallback((): RouteContext => {
    const parts = location.pathname.split('/').filter(Boolean);

    const kindMap: Record<string, string> = {
      pods: 'Pod', deployments: 'Deployment', services: 'Service',
      nodes: 'Node', persistentvolumeclaims: 'PVC', configmaps: 'ConfigMap',
      secrets: 'Secret', ingresses: 'Ingress', daemonsets: 'DaemonSet',
      statefulsets: 'StatefulSet', jobs: 'Job', cronjobs: 'CronJob',
    };

    const namespaceIdx = parts.indexOf('namespaces');
    let namespace = '';
    let resourceType = '';
    let resourceName = '';

    if (namespaceIdx !== -1) {
      namespace = parts[namespaceIdx + 1] ?? '';
      resourceType = parts[namespaceIdx + 2] ?? '';
      resourceName = parts[namespaceIdx + 3] ?? '';
    } else {
      for (let i = 0; i < parts.length; i++) {
        const normalized = parts[i].toLowerCase();
        if (kindMap[normalized]) {
          resourceType = normalized;
          resourceName = parts[i + 1] ?? '';
          break;
        }
      }
    }

    const resourceKind = kindMap[resourceType.toLowerCase()] ?? '';
    const screen = resourceType
      ? resourceName ? `${resourceType}-detail` : `${resourceType}-list`
      : 'dashboard';

    return { namespace, resource: resourceType, screen, resourceName, resourceKind };
  }, [location.pathname]);
}

// ─── Quick action chips ────────────────────────────────────────────────────────

type PageChip = { label: string; query: string };

function getQuickChips(screen: string, resourceName?: string, namespace?: string): PageChip[] {
  const ctx = resourceName && namespace
    ? ` for ${resourceName} in ${namespace}`
    : resourceName ? ` for ${resourceName}` : '';

  switch (screen) {
    case 'dashboard':
      return [
        { label: 'What needs attention?', query: 'What needs my attention right now?' },
        { label: 'Cluster health', query: 'Show me a comprehensive cluster health analysis' },
        { label: 'Explain alerts', query: 'Explain the current alerts and their severity' },
        { label: 'Resource summary', query: 'Give me a resource usage summary' },
      ];
    case 'pods':
    case 'pods-list':
      return [
        { label: 'Find crash loops', query: 'Find all pods in CrashLoopBackOff' },
        { label: 'OOM killed', query: 'Which pods have been OOMKilled recently?' },
        { label: 'High restarts', query: 'Show pods with restart count above 5' },
        { label: 'Pending pods', query: 'Why are there pending pods?' },
        { label: 'Missing limits', query: 'Which pods are missing resource limits?' },
      ];
    case 'pods-detail':
      return [
        { label: 'Analyze this pod', query: `Analyze pod${ctx}` },
        { label: 'Show logs', query: `Show recent error logs${ctx}` },
        { label: 'Why failing?', query: `Why is this pod failing${ctx}?` },
        { label: 'Ownership chain', query: `Show ownership chain${ctx}` },
      ];
    case 'deployments':
    case 'deployments-list':
      return [
        { label: 'Needs attention', query: 'Which deployments need attention?' },
        { label: 'Rollout failures', query: 'Are there any stalled rollouts?' },
        { label: 'Scale down safely?', query: 'Which deployments can I safely scale down?' },
        { label: 'Image issues', query: 'Are there any image pull errors?' },
      ];
    case 'deployments-detail':
      return [
        { label: 'Analyze deployment', query: `Analyze deployment${ctx}` },
        { label: 'Rollback risk', query: `What is the rollback risk${ctx}?` },
        { label: 'Scaling rec.', query: `Should I scale${ctx}?` },
        { label: 'Health check', query: `Run a health check on${ctx}` },
      ];
    case 'nodes':
    case 'nodes-list':
      return [
        { label: 'Check pressure', query: 'Check node memory and disk pressure' },
        { label: 'Capacity analysis', query: 'Show node capacity and allocation' },
        { label: 'Heaviest pods', query: 'Which nodes host the most resource-intensive pods?' },
        { label: 'Safe to drain?', query: 'Is it safe to drain a node right now?' },
      ];
    case 'nodes-detail':
      return [
        { label: 'Analyze node', query: `Analyze node${ctx}` },
        { label: 'Pods on this node', query: `List all pods on${ctx}` },
        { label: 'Safe to drain?', query: `Is it safe to drain${ctx}?` },
        { label: 'Node events', query: `Show recent events for${ctx}` },
      ];
    case 'services':
    case 'services-list':
      return [
        { label: 'No endpoints', query: 'Find services with no ready endpoints' },
        { label: 'Exposure risk', query: 'Which services are exposed externally with risk?' },
        { label: 'Network policies', query: 'Show which services are blocked by network policies' },
        { label: 'Connectivity check', query: 'Run a network connectivity analysis' },
      ];
    case 'persistentvolumeclaims':
    case 'persistentvolumeclaims-list':
      return [
        { label: 'Unbound PVCs', query: 'Find all unbound PersistentVolumeClaims' },
        { label: 'Storage health', query: 'Run a storage health analysis' },
        { label: 'Orphaned PVs', query: 'Are there any orphaned PersistentVolumes?' },
        { label: 'Capacity forecast', query: 'Forecast storage capacity needs' },
      ];
    case 'security':
      return [
        { label: 'RBAC audit', query: 'Run a full RBAC permissions audit' },
        { label: 'Cluster-admin?', query: 'Who has cluster-admin access?' },
        { label: 'CIS benchmark', query: 'Run a CIS Kubernetes benchmark check' },
        { label: 'Privileged containers', query: 'Find all containers running as privileged' },
      ];
    default:
      return [
        { label: 'Cluster status', query: 'What is the overall cluster status?' },
        { label: 'Recent warnings', query: 'Show me recent warning events' },
        { label: 'Health summary', query: 'Give me a health summary' },
        { label: 'What can you do?', query: 'What can you help me with?' },
      ];
  }
}

function getKindIcon(kind: string): React.ElementType {
  const map: Record<string, React.ElementType> = {
    Pod: Box, Deployment: LayoutDashboard, Service: Network,
    Node: Server, PVC: HardDrive, ConfigMap: Settings2,
    Secret: Lock, Ingress: Network, DaemonSet: LayoutDashboard,
    StatefulSet: LayoutDashboard, Job: Zap, CronJob: Zap,
  };
  return map[kind] ?? Box;
}

// ─── ContextBar ────────────────────────────────────────────────────────────────

interface ContextBarProps {
  resourceKind: string;
  resourceName: string;
  namespace: string;
  onClear: () => void;
}

function ContextBar({ resourceKind, resourceName, namespace, onClear }: ContextBarProps) {
  const KindIcon = getKindIcon(resourceKind);
  return (
    <div className="flex items-center gap-2 px-4 py-1.5 border-b border-border bg-primary/5 shrink-0">
      <span className="text-[10px] text-muted-foreground shrink-0">Context:</span>
      <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-primary/10 border border-primary/20 min-w-0 overflow-hidden">
        <KindIcon className="h-3 w-3 text-primary shrink-0" />
        <span className="text-[11px] font-medium text-primary truncate">{resourceName}</span>
        {namespace && (
          <span className="text-[11px] text-primary/60 shrink-0 ml-0.5">{namespace}</span>
        )}
      </div>
      <button
        onClick={onClear}
        className="ml-auto shrink-0 text-muted-foreground hover:text-foreground transition-colors"
        title="Clear context"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}

// ─── QuickActionChips ──────────────────────────────────────────────────────────

interface QuickActionChipsProps {
  screen: string;
  resourceName?: string;
  namespace?: string;
  onChipClick: (query: string) => void;
}

function QuickActionChips({ screen, resourceName, namespace, onChipClick }: QuickActionChipsProps) {
  const chips = getQuickChips(screen, resourceName, namespace);
  return (
    <div className="flex gap-1.5 px-4 py-2 overflow-x-auto scrollbar-none border-t border-border/50 shrink-0">
      {chips.map((chip) => (
        <button
          key={chip.query}
          onClick={() => onChipClick(chip.query)}
          className="shrink-0 px-3 py-1 rounded-full text-[11px] font-medium
                     bg-muted hover:bg-muted/70 text-muted-foreground hover:text-foreground
                     border border-border/50 transition-colors whitespace-nowrap"
        >
          {chip.label}
        </button>
      ))}
    </div>
  );
}

// ─── AIStatusFooter ────────────────────────────────────────────────────────────

interface AIStatusFooterProps {
  isConnected: boolean;
  isConnecting: boolean;
  onReconnect: () => void;
  onClearMessages: () => void;
  hasMessages: boolean;
}

function AIStatusFooter({ isConnected, isConnecting, onReconnect, onClearMessages, hasMessages }: AIStatusFooterProps) {
  return (
    <div className="flex items-center justify-between px-4 py-1.5 border-t border-border bg-muted/10 shrink-0">
      <div className="flex items-center gap-1.5">
        {isConnecting ? (
          <>
            <span className="h-1.5 w-1.5 rounded-full bg-yellow-500 animate-pulse" />
            <span className="text-[10px] text-muted-foreground">Connecting…</span>
          </>
        ) : isConnected ? (
          <>
            <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
            <span className="text-[10px] text-muted-foreground">Connected</span>
          </>
        ) : (
          <>
            <span className="h-1.5 w-1.5 rounded-full bg-red-500 animate-pulse" />
            <span className="text-[10px] text-muted-foreground">Disconnected</span>
            <button
              onClick={onReconnect}
              className="text-[10px] text-primary hover:underline ml-1"
            >
              Reconnect
            </button>
          </>
        )}
      </div>
      {hasMessages && (
        <button
          onClick={onClearMessages}
          className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
          title="Clear chat history"
        >
          <Trash2 className="h-3 w-3" />
          Clear
        </button>
      )}
    </div>
  );
}

// ─── AssistantMessage — section-aware renderer ─────────────────────────────────

interface ResponseSections {
  whatYouAsked?: string;
  whatIExecuted?: string;
  whatIFound?: string;
  seniorAnalysis?: string;
  suggestedActions?: string;
}

function parseResponseSections(content: string): ResponseSections | null {
  const hasStructure =
    content.includes('🧠') || content.includes('⚙️') ||
    content.includes('📊') || content.includes('🔍') || content.includes('🛠');
  if (!hasStructure) return null;

  const extractSection = (startEmoji: string, ...endEmojis: string[]) => {
    const startIdx = content.indexOf(startEmoji);
    if (startIdx === -1) return undefined;
    let endIdx = content.length;
    for (const emoji of endEmojis) {
      const idx = content.indexOf(emoji, startIdx + 1);
      if (idx !== -1 && idx < endIdx) endIdx = idx;
    }
    const raw = content.slice(startIdx, endIdx);
    // Strip the header line (emoji + title)
    const newlineIdx = raw.indexOf('\n');
    return newlineIdx !== -1 ? raw.slice(newlineIdx + 1).trim() : raw.trim();
  };

  const sections: ResponseSections = {
    whatYouAsked: extractSection('🧠', '⚙️', '📊', '🔍', '🛠'),
    whatIExecuted: extractSection('⚙️', '📊', '🔍', '🛠'),
    whatIFound: extractSection('📊', '🔍', '🛠'),
    seniorAnalysis: extractSection('🔍', '🛠'),
    suggestedActions: extractSection('🛠'),
  };

  const hasContent = Object.values(sections).some(v => v && v.length > 0);
  return hasContent ? sections : null;
}

interface CollapsibleSectionProps {
  icon: string;
  title: string;
  content: string;
  defaultOpen?: boolean;
  highlight?: boolean;
}

function MarkdownContent({ content }: { content: string }) {
  return (
    <div className="prose prose-sm dark:prose-invert max-w-none prose-table:text-xs prose-th:py-1 prose-th:px-2 prose-td:py-1 prose-td:px-2 prose-p:my-1">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>
        {content}
      </ReactMarkdown>
    </div>
  );
}

function CollapsibleSection({ icon, title, content, defaultOpen = true, highlight = false }: CollapsibleSectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={cn(
      'rounded-lg border overflow-hidden',
      highlight ? 'border-primary/20 bg-primary/5' : 'border-border/40 bg-muted/20'
    )}>
      <button
        className="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-muted/30 transition-colors"
        onClick={() => setOpen(o => !o)}
      >
        <span className="text-sm">{icon}</span>
        <span className={cn('text-[11px] font-semibold flex-1', highlight ? 'text-primary' : 'text-muted-foreground')}>
          {title}
        </span>
        {open
          ? <ChevronUp className="h-3 w-3 text-muted-foreground shrink-0" />
          : <ChevronDown className="h-3 w-3 text-muted-foreground shrink-0" />}
      </button>
      {open && (
        <div className="px-3 pb-2 pt-1 text-sm leading-relaxed">
          <MarkdownContent content={content} />
        </div>
      )}
    </div>
  );
}

function KubectlCommand({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center gap-2 px-2 py-1 rounded bg-muted/50 border border-border/40">
      <code className="flex-1 text-[10px] font-mono text-foreground/80 truncate">{command}</code>
      <button
        onClick={() => {
          navigator.clipboard.writeText(command);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        }}
        className="shrink-0 text-muted-foreground hover:text-foreground transition-colors"
        title="Copy command"
      >
        {copied
          ? <CheckCircle className="h-3 w-3 text-green-500" />
          : <Copy className="h-3 w-3" />}
      </button>
    </div>
  );
}

function ActionsSection({ content }: { content: string }) {
  const cmdRegex = /`(kubectl[^`]+)`/g;
  const commands: string[] = [];
  let match;
  while ((match = cmdRegex.exec(content)) !== null) {
    commands.push(match[1]);
  }
  return (
    <div className="rounded-lg border border-border/40 bg-muted/20 overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border/30">
        <span className="text-sm">🛠</span>
        <span className="text-[11px] font-semibold text-muted-foreground">Suggested Actions</span>
      </div>
      <div className="px-3 py-2 text-sm leading-relaxed">
        <MarkdownContent content={content} />
      </div>
      {commands.length > 0 && (
        <div className="px-3 pb-2 space-y-1.5">
          {commands.map((cmd, i) => <KubectlCommand key={i} command={cmd} />)}
        </div>
      )}
    </div>
  );
}

function AssistantMessage({ content, onCopy, copied }: {
  content: string;
  onCopy: () => void;
  copied: boolean;
}) {
  const sections = parseResponseSections(content);
  return (
    <div className="space-y-1.5">
      {sections ? (
        <>
          {sections.whatYouAsked && (
            <CollapsibleSection icon="🧠" title="What you asked" content={sections.whatYouAsked} defaultOpen={false} />
          )}
          {sections.whatIExecuted && (
            <CollapsibleSection icon="⚙️" title="What I executed" content={sections.whatIExecuted} defaultOpen={false} />
          )}
          {sections.whatIFound && (
            <CollapsibleSection icon="📊" title="What I found" content={sections.whatIFound} />
          )}
          {sections.seniorAnalysis && (
            <CollapsibleSection icon="🔍" title="Analysis" content={sections.seniorAnalysis} highlight />
          )}
          {sections.suggestedActions && (
            <ActionsSection content={sections.suggestedActions} />
          )}
        </>
      ) : (
        <div className="text-sm leading-relaxed">
          <MarkdownContent content={content} />
        </div>
      )}
      <button
        onClick={onCopy}
        className="mt-1 text-[10px] text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors"
      >
        {copied
          ? <><CheckCircle className="h-3 w-3" />Copied</>
          : <><Copy className="h-3 w-3" />Copy</>}
      </button>
    </div>
  );
}

// ─── Tool category helpers ─────────────────────────────────────────────────────

const TOOL_CATEGORY_CONFIG: Record<string, {
  color: string;
  bgColor: string;
  borderColor: string;
  icon: React.ElementType;
  label: string;
}> = {
  observe: { color: 'text-blue-600 dark:text-blue-400', bgColor: 'bg-blue-500/8', borderColor: 'border-blue-500/25', icon: Eye, label: 'Observe' },
  analyze: { color: 'text-purple-600 dark:text-purple-400', bgColor: 'bg-purple-500/8', borderColor: 'border-purple-500/25', icon: Activity, label: 'Analyze' },
  troubleshoot: { color: 'text-orange-600 dark:text-orange-400', bgColor: 'bg-orange-500/8', borderColor: 'border-orange-500/25', icon: Search, label: 'Troubleshoot' },
  recommend: { color: 'text-cyan-600 dark:text-cyan-400', bgColor: 'bg-cyan-500/8', borderColor: 'border-cyan-500/25', icon: Zap, label: 'Recommend' },
  security: { color: 'text-red-600 dark:text-red-400', bgColor: 'bg-red-500/8', borderColor: 'border-red-500/25', icon: Shield, label: 'Security' },
  cost: { color: 'text-green-600 dark:text-green-400', bgColor: 'bg-green-500/8', borderColor: 'border-green-500/25', icon: DollarSign, label: 'Cost' },
  action: { color: 'text-amber-600 dark:text-amber-400', bgColor: 'bg-amber-500/8', borderColor: 'border-amber-500/25', icon: Terminal, label: 'Action' },
  automation: { color: 'text-indigo-600 dark:text-indigo-400', bgColor: 'bg-indigo-500/8', borderColor: 'border-indigo-500/25', icon: Settings2, label: 'Automate' },
  export: { color: 'text-teal-600 dark:text-teal-400', bgColor: 'bg-teal-500/8', borderColor: 'border-teal-500/25', icon: Eye, label: 'Export' },
};

function getToolCategory(toolName: string) {
  const prefix = toolName.split('_')[0];
  return TOOL_CATEGORY_CONFIG[prefix] ?? {
    color: 'text-muted-foreground', bgColor: 'bg-muted/50',
    borderColor: 'border-border', icon: Wrench, label: 'Tool',
  };
}

function humanizeToolName(toolName: string): string {
  return toolName.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

// ─── Analysis result card helpers ──────────────────────────────────────────────

const SEVERITY_CONFIG: Record<string, { color: string; bg: string; label: string }> = {
  CRITICAL: { color: 'text-red-700 dark:text-red-400', bg: 'bg-red-500/15', label: 'Critical' },
  HIGH: { color: 'text-orange-700 dark:text-orange-400', bg: 'bg-orange-500/15', label: 'High' },
  MEDIUM: { color: 'text-yellow-700 dark:text-yellow-400', bg: 'bg-yellow-500/15', label: 'Medium' },
  LOW: { color: 'text-green-700 dark:text-green-400', bg: 'bg-green-500/15', label: 'Low' },
};

function SeverityBadge({ severity }: { severity: string }) {
  const cfg = SEVERITY_CONFIG[severity?.toUpperCase()] ?? SEVERITY_CONFIG.LOW;
  return (
    <span className={cn('px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wide', cfg.color, cfg.bg)}>
      {cfg.label}
    </span>
  );
}

function SecurityScoreGauge({ score }: { score: number }) {
  const clamped = Math.max(0, Math.min(100, score));
  const radius = 28;
  const circumference = 2 * Math.PI * radius;
  const strokeDash = (clamped / 100) * circumference;
  const color = clamped >= 80 ? '#22c55e' : clamped >= 60 ? '#f59e0b' : clamped >= 40 ? '#f97316' : '#ef4444';
  return (
    <div className="flex flex-col items-center gap-0.5">
      <svg width="72" height="72" viewBox="0 0 72 72">
        <circle cx="36" cy="36" r={radius} fill="none" stroke="currentColor" strokeWidth="5" className="text-muted/20" />
        <circle cx="36" cy="36" r={radius} fill="none" stroke={color} strokeWidth="5"
          strokeDasharray={`${strokeDash} ${circumference - strokeDash}`}
          strokeLinecap="round" transform="rotate(-90 36 36)"
          style={{ transition: 'stroke-dasharray 0.6s ease' }} />
        <text x="36" y="40" textAnchor="middle" fontSize="14" fontWeight="700" fill={color}>{clamped}</text>
      </svg>
      <span className="text-[9px] text-muted-foreground">/ 100</span>
    </div>
  );
}

function ProgressBar({ value, max, color = 'bg-green-500' }: { value: number; max: number; color?: string }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div className="w-full h-1 rounded-full bg-muted/30 overflow-hidden">
      <div className={cn('h-full rounded-full transition-all', color)} style={{ width: `${pct}%` }} />
    </div>
  );
}

function IssueRow({ issue }: { issue: Record<string, unknown> }) {
  const sev = (issue.severity as string) ?? 'LOW';
  const msg = (issue.message as string) ?? JSON.stringify(issue);
  const type = (issue.type || issue.check) as string | undefined;
  return (
    <div className="flex items-start gap-1.5 py-1 border-b border-border/30 last:border-0">
      <SeverityBadge severity={sev} />
      <div className="flex-1 min-w-0">
        {type && <span className="text-[9px] font-semibold text-muted-foreground uppercase">{type} · </span>}
        <span className="text-[10px] text-foreground/80 break-words">{msg}</span>
      </div>
    </div>
  );
}

// ─── Deep-analysis result renderers ───────────────────────────────────────────

const DEEP_ANALYSIS_TOOLS = new Set([
  'analyze_pod_health', 'analyze_deployment_health', 'analyze_node_pressure',
  'detect_resource_contention', 'analyze_network_connectivity', 'analyze_rbac_permissions',
  'analyze_storage_health', 'check_resource_limits', 'analyze_hpa_behavior',
  'analyze_log_patterns', 'assess_security_posture', 'detect_configuration_drift',
]);

function AnalysisPodHealthCard({ data }: { data: Record<string, unknown> }) {
  const issues = (data.issues as Record<string, unknown>[]) ?? [];
  const healthy = (data.healthy as number) ?? 0;
  const total = (data.total_pods as number) ?? 0;
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3">
        <div className="flex-1">
          <div className="flex justify-between text-[10px] mb-1">
            <span className="text-muted-foreground">Healthy pods</span>
            <span className="font-semibold">{healthy}/{total}</span>
          </div>
          <ProgressBar value={healthy} max={total} color={healthy === total ? 'bg-green-500' : 'bg-amber-500'} />
        </div>
        <div className="text-right">
          <div className="text-[10px] text-muted-foreground">Issues</div>
          <div className={cn('text-sm font-bold', issues.length > 0 ? 'text-orange-500' : 'text-green-500')}>{issues.length}</div>
        </div>
      </div>
      {issues.length > 0 && (
        <div className="border border-border/40 rounded-lg overflow-hidden">
          {issues.slice(0, 6).map((issue, i) => <IssueRow key={i} issue={issue} />)}
          {issues.length > 6 && <div className="text-[9px] text-muted-foreground px-2 py-1">+{issues.length - 6} more issues</div>}
        </div>
      )}
    </div>
  );
}

function AnalysisDeploymentHealthCard({ data }: { data: Record<string, unknown> }) {
  const deployments = (data.deployments as Record<string, unknown>[]) ?? [];
  const healthColor: Record<string, string> = { Healthy: 'text-green-500', Degraded: 'text-amber-500', Critical: 'text-red-500' };
  return (
    <div className="space-y-1.5">
      {deployments.slice(0, 8).map((d, i) => {
        const health = (d.health as string) ?? 'Healthy';
        const desired = (d.desired_replicas as number) ?? 0;
        const ready = (d.ready_replicas as number) ?? 0;
        const issues = (d.issues as string[]) ?? [];
        return (
          <div key={i} className="flex items-center gap-2 text-[10px]">
            <div className="w-2 h-2 rounded-full shrink-0" style={{
              background: health === 'Healthy' ? '#22c55e' : health === 'Degraded' ? '#f59e0b' : '#ef4444'
            }} />
            <span className="font-medium truncate flex-1">{d.name as string}</span>
            <span className={cn('font-semibold', healthColor[health] ?? 'text-muted-foreground')}>{health}</span>
            <span className="text-muted-foreground shrink-0">{ready}/{desired}</span>
            {issues.length > 0 && <SeverityBadge severity="HIGH" />}
          </div>
        );
      })}
      {deployments.length > 8 && <div className="text-[9px] text-muted-foreground">+{deployments.length - 8} more</div>}
    </div>
  );
}

function AnalysisNodePressureCard({ data }: { data: Record<string, unknown> }) {
  const nodes = (data.nodes as Record<string, unknown>[]) ?? [];
  const underPressure = (data.nodes_under_pressure as number) ?? 0;
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
        <span>{data.total_nodes as number} nodes</span>
        <span>·</span>
        <span className={underPressure > 0 ? 'text-red-500 font-semibold' : 'text-green-500'}>{underPressure} under pressure</span>
      </div>
      {nodes.filter(n => n.severity === 'HIGH').slice(0, 5).map((n, i) => {
        const pressures = (n.active_pressures as string[]) ?? [];
        return (
          <div key={i} className="flex items-center gap-1.5 text-[10px]">
            <AlertCircle className="h-3 w-3 text-red-500 shrink-0" />
            <span className="font-medium truncate flex-1">{n.node as string}</span>
            <div className="flex gap-1">
              {pressures.map(p => (
                <span key={p} className="px-1 py-0.5 rounded bg-red-500/15 text-red-600 dark:text-red-400 text-[9px] font-medium">
                  {p.replace('Pressure', '')}
                </span>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function AnalysisSecurityPostureCard({ data }: { data: Record<string, unknown> }) {
  const score = (data.security_score as number) ?? 100;
  const findings = (data.findings as Record<string, unknown>[]) ?? [];
  const riskLevel = (data.risk_level as string) ?? 'LOW';
  const bySeverity = findings.reduce<Record<string, number>>((acc, f) => {
    const sev = (f.severity as string) ?? 'LOW';
    acc[sev] = (acc[sev] ?? 0) + 1;
    return acc;
  }, {});
  return (
    <div className="space-y-3">
      <div className="flex items-start gap-4">
        <SecurityScoreGauge score={score} />
        <div className="flex-1 space-y-1.5 pt-1">
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] text-muted-foreground">Risk Level</span>
            <SeverityBadge severity={riskLevel} />
          </div>
          <div className="text-[10px] text-muted-foreground">{data.total_findings as number} findings</div>
          <div className="flex flex-wrap gap-1">
            {Object.entries(bySeverity).map(([sev, count]) => (
              <span key={sev} className={cn('px-1.5 py-0.5 rounded text-[9px] font-medium', SEVERITY_CONFIG[sev]?.color, SEVERITY_CONFIG[sev]?.bg)}>
                {count} {sev.toLowerCase()}
              </span>
            ))}
          </div>
        </div>
      </div>
      {findings.length > 0 && (
        <div className="border border-border/40 rounded-lg overflow-hidden">
          <div className="px-2 py-1 bg-muted/20 text-[9px] font-semibold text-muted-foreground uppercase tracking-wide">CIS Benchmark Findings</div>
          {findings.slice(0, 5).map((f, i) => (
            <div key={i} className="flex items-start gap-1.5 px-2 py-1.5 border-t border-border/20">
              <SeverityBadge severity={(f.severity as string)} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1">
                  <span className="text-[9px] font-mono text-muted-foreground">{f.cis_id as string}</span>
                  <span className="text-[9px] font-semibold">{f.check as string}</span>
                </div>
                <div className="text-[9px] text-foreground/70 truncate">{f.message as string}</div>
              </div>
            </div>
          ))}
          {findings.length > 5 && <div className="text-[9px] text-muted-foreground px-2 py-1">+{findings.length - 5} more findings</div>}
        </div>
      )}
    </div>
  );
}

function AnalysisStorageHealthCard({ data }: { data: Record<string, unknown> }) {
  const total = (data.total_pvcs as number) ?? 0;
  const bound = (data.bound_pvcs as number) ?? 0;
  const unbound = (data.unbound_pvcs as number) ?? 0;
  const isHealthy = (data.storage_health as string) === 'Healthy';
  const unbound_details = (data.unbound_details as Record<string, unknown>[]) ?? [];
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3">
        <div className="flex-1">
          <div className="flex justify-between text-[10px] mb-1">
            <span className="text-muted-foreground">Bound PVCs</span>
            <span className="font-semibold">{bound}/{total}</span>
          </div>
          <ProgressBar value={bound} max={total} color={isHealthy ? 'bg-green-500' : 'bg-red-500'} />
        </div>
        <span className={cn('text-xs font-bold', isHealthy ? 'text-green-500' : 'text-red-500')}>{data.storage_health as string}</span>
      </div>
      {unbound_details.length > 0 && (
        <div className="border border-border/40 rounded-lg overflow-hidden">
          {unbound_details.slice(0, 4).map((pvc, i) => <IssueRow key={i} issue={pvc} />)}
        </div>
      )}
      {unbound > 0 && (
        <div className="text-[9px] text-orange-600 dark:text-orange-400">
          ⚠ {unbound} PVC{unbound > 1 ? 's' : ''} unbound — pods may fail to start
        </div>
      )}
    </div>
  );
}

function AnalysisRBACCard({ data }: { data: Record<string, unknown> }) {
  const overprivileged = (data.overprivileged_accounts as number) ?? 0;
  const findings = (data.findings as Record<string, unknown>[]) ?? [];
  const riskLevel = (data.risk_level as string) ?? 'LOW';
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-[10px]">
        <span className="text-muted-foreground">Risk:</span>
        <SeverityBadge severity={riskLevel} />
        <span className="text-muted-foreground ml-auto">{overprivileged} over-privileged SAs</span>
      </div>
      {findings.length > 0 && (
        <div className="border border-border/40 rounded-lg overflow-hidden">
          <div className="px-2 py-1 bg-muted/20 text-[9px] font-semibold text-muted-foreground uppercase tracking-wide">RBAC Findings</div>
          {findings.slice(0, 4).map((f, i) => (
            <div key={i} className="px-2 py-1.5 border-t border-border/20 text-[10px]">
              <div className="flex items-center gap-1 mb-0.5">
                <SeverityBadge severity={(f.severity as string)} />
                <span className="font-mono font-medium">{f.service_account as string}</span>
                <span className="ml-auto px-1 py-0.5 rounded bg-orange-500/15 text-orange-600 dark:text-orange-400 text-[9px]">
                  {f.role_name as string}
                </span>
              </div>
              {f.recommendation && <div className="text-[9px] text-muted-foreground truncate">{f.recommendation as string}</div>}
            </div>
          ))}
          {findings.length > 4 && <div className="text-[9px] text-muted-foreground px-2 py-1">+{findings.length - 4} more</div>}
        </div>
      )}
    </div>
  );
}

function AnalysisLogPatternsCard({ data }: { data: Record<string, unknown> }) {
  const errorCount = (data.error_count as number) ?? 0;
  const linesAnalysed = (data.lines_analysed as number) ?? 0;
  const severity = (data.severity as string) ?? 'LOW';
  const errorPatterns = (data.error_patterns as Record<string, number>) ?? {};
  const sampleErrors = (data.sample_errors as string[]) ?? [];
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3">
        <div className="text-center">
          <div className={cn('text-lg font-bold', errorCount > 0 ? 'text-red-500' : 'text-green-500')}>{errorCount}</div>
          <div className="text-[9px] text-muted-foreground">errors</div>
        </div>
        <div className="flex-1 space-y-1">
          <div className="text-[10px] text-muted-foreground">{linesAnalysed} lines analysed · pod: <span className="font-mono">{data.pod as string}</span></div>
          <div className="flex items-center gap-1">
            <span className="text-[9px] text-muted-foreground">Severity:</span>
            <SeverityBadge severity={severity} />
          </div>
        </div>
      </div>
      {Object.keys(errorPatterns).length > 0 && (
        <div className="flex flex-wrap gap-1">
          {Object.entries(errorPatterns).map(([kw, count]) => (
            <span key={kw} className="px-1.5 py-0.5 rounded bg-red-500/10 text-red-600 dark:text-red-400 text-[9px] font-medium">
              {kw}: {count}
            </span>
          ))}
        </div>
      )}
      {sampleErrors.length > 0 && (
        <div className="border border-border/40 rounded-lg overflow-hidden">
          <div className="px-2 py-1 bg-muted/20 text-[9px] font-semibold text-muted-foreground uppercase tracking-wide">Sample Errors</div>
          {sampleErrors.slice(0, 3).map((line, i) => (
            <div key={i} className="px-2 py-1 border-t border-border/20 text-[9px] font-mono text-foreground/70 truncate">{line}</div>
          ))}
        </div>
      )}
    </div>
  );
}

function AnalysisDriftCard({ data }: { data: Record<string, unknown> }) {
  const hasDrift = (data.has_drift as boolean) ?? false;
  const driftCount = (data.drift_count as number) ?? 0;
  const drifts = (data.drifts as Record<string, unknown>[]) ?? [];
  const resource = (data.resource as string) ?? '';
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-[10px]">
        <span className="font-mono text-muted-foreground truncate">{resource}</span>
        <div className={cn(
          'ml-auto flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold',
          hasDrift ? 'bg-orange-500/15 text-orange-600 dark:text-orange-400' : 'bg-green-500/15 text-green-600 dark:text-green-400'
        )}>
          {hasDrift ? '⚠ Drifted' : '✓ In Sync'}
        </div>
      </div>
      {drifts.length > 0 && (
        <div className="border border-border/40 rounded-lg overflow-hidden">
          <div className="px-2 py-1 bg-muted/20 text-[9px] font-semibold text-muted-foreground uppercase tracking-wide">
            {driftCount} field{driftCount > 1 ? 's' : ''} drifted
          </div>
          {drifts.slice(0, 6).map((d, i) => (
            <div key={i} className="px-2 py-1.5 border-t border-border/20 text-[9px]">
              <div className="font-mono text-purple-600 dark:text-purple-400 truncate">{d.path as string}</div>
              <div className="flex gap-2 mt-0.5">
                <span className="text-muted-foreground">want: <span className="text-foreground/80">{JSON.stringify(d.desired)}</span></span>
                <span className="text-muted-foreground">got: <span className="text-orange-500">{JSON.stringify(d.actual)}</span></span>
              </div>
            </div>
          ))}
          {drifts.length > 6 && <div className="text-[9px] text-muted-foreground px-2 py-1">+{drifts.length - 6} more drifts</div>}
        </div>
      )}
    </div>
  );
}

function AnalysisHPACard({ data }: { data: Record<string, unknown> }) {
  const hpas = (data.hpas as Record<string, unknown>[]) ?? [];
  return (
    <div className="space-y-1.5">
      <div className="text-[10px] text-muted-foreground">{data.total as number} HPAs in {data.namespace as string}</div>
      {hpas.slice(0, 5).map((hpa, i) => {
        const warnings = (hpa.warnings as string[]) ?? [];
        const current = hpa.current_replicas as number;
        const max = hpa.max_replicas as number;
        const atMax = hpa.at_max_replicas as boolean;
        return (
          <div key={i} className="border border-border/40 rounded-lg px-2 py-1.5 text-[10px]">
            <div className="flex items-center gap-1.5 mb-1">
              <span className="font-medium truncate flex-1">{hpa.name as string}</span>
              <span className="text-muted-foreground">{current}/{max} replicas</span>
              {atMax && <SeverityBadge severity="MEDIUM" />}
            </div>
            {warnings.slice(0, 2).map((w, j) => (
              <div key={j} className="text-[9px] text-amber-600 dark:text-amber-400 truncate">⚡ {w}</div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

function AnalysisContentionCard({ data }: { data: Record<string, unknown> }) {
  const risk = (data.contention_risk as string) ?? 'LOW';
  const missingLimits = (data.pods_missing_limits as number) ?? 0;
  const missingRequests = (data.pods_missing_requests as number) ?? 0;
  const containers = (data.containers_missing_limits as string[]) ?? [];
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-[10px]">
        <span className="text-muted-foreground">Contention Risk:</span>
        <SeverityBadge severity={risk} />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-lg border border-border/40 px-2 py-1.5 text-center">
          <div className={cn('text-sm font-bold', missingLimits > 0 ? 'text-orange-500' : 'text-green-500')}>{missingLimits}</div>
          <div className="text-[9px] text-muted-foreground">missing limits</div>
        </div>
        <div className="rounded-lg border border-border/40 px-2 py-1.5 text-center">
          <div className={cn('text-sm font-bold', missingRequests > 0 ? 'text-amber-500' : 'text-green-500')}>{missingRequests}</div>
          <div className="text-[9px] text-muted-foreground">missing requests</div>
        </div>
      </div>
      {containers.length > 0 && (
        <div className="text-[9px] text-muted-foreground">
          {containers.slice(0, 3).join(', ')}{containers.length > 3 && ` +${containers.length - 3} more`}
        </div>
      )}
    </div>
  );
}

function AnalysisNetworkCard({ data }: { data: Record<string, unknown> }) {
  const services = (data.services as Record<string, unknown>[]) ?? [];
  const noEndpoints = services.filter(s => s.status === 'NO_ENDPOINTS');
  const netPolicies = (data.network_policies as number) ?? 0;
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3 text-[10px]">
        <span className="text-muted-foreground">{services.length} services</span>
        <span className={cn(noEndpoints.length > 0 ? 'text-red-500 font-semibold' : 'text-green-500')}>{noEndpoints.length} no-endpoint</span>
        <span className="text-muted-foreground ml-auto">{netPolicies} network policies</span>
      </div>
      {noEndpoints.length > 0 && (
        <div className="border border-border/40 rounded-lg overflow-hidden">
          {noEndpoints.slice(0, 4).map((s, i) => (
            <div key={i} className="flex items-center gap-1.5 px-2 py-1 border-b border-border/20 last:border-0 text-[10px]">
              <span className="h-1.5 w-1.5 rounded-full bg-red-500 shrink-0" />
              <span className="font-mono truncate">{s.service as string}</span>
              <span className="ml-auto text-red-500 text-[9px]">NO_ENDPOINTS</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function AnalysisResourceLimitsCard({ data }: { data: Record<string, unknown> }) {
  const totalPods = (data.total_pods as number) ?? 0;
  const violations = (data.violations as number) ?? 0;
  const complianceRate = (data.compliance_rate as string) ?? '100.0%';
  const violationList = (data.violation_list as Record<string, unknown>[]) ?? [];
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3">
        <div className="flex-1">
          <div className="flex justify-between text-[10px] mb-1">
            <span className="text-muted-foreground">Compliance rate</span>
            <span className="font-semibold">{complianceRate}</span>
          </div>
          <ProgressBar value={totalPods - violations} max={totalPods}
            color={violations === 0 ? 'bg-green-500' : violations < 5 ? 'bg-amber-500' : 'bg-red-500'} />
        </div>
        <div className="text-right">
          <div className="text-[10px] text-muted-foreground">Violations</div>
          <div className={cn('text-sm font-bold', violations > 0 ? 'text-orange-500' : 'text-green-500')}>{violations}</div>
        </div>
      </div>
      {violationList.length > 0 && (
        <div className="border border-border/40 rounded-lg overflow-hidden">
          {violationList.slice(0, 4).map((v, i) => (
            <div key={i} className="flex items-center gap-1.5 px-2 py-1 border-b border-border/20 last:border-0 text-[9px]">
              <SeverityBadge severity={(v.severity as string)} />
              <span className="font-mono truncate">{v.pod as string}/{v.container as string}</span>
              <span className="ml-auto text-muted-foreground">{(v.missing as string[]).join(', ')}</span>
            </div>
          ))}
          {violationList.length > 4 && <div className="text-[9px] text-muted-foreground px-2 py-1">+{violationList.length - 4} more</div>}
        </div>
      )}
    </div>
  );
}

function AnalysisResultCard({ toolName, resultJson }: { toolName: string; resultJson: string }) {
  let parsed: Record<string, unknown> | null = null;
  try { parsed = JSON.parse(resultJson) as Record<string, unknown>; } catch { /* raw */ }
  if (!parsed) return <pre className="text-[10px] leading-relaxed break-all whitespace-pre-wrap text-muted-foreground">{resultJson}</pre>;
  switch (toolName) {
    case 'analyze_pod_health': return <AnalysisPodHealthCard data={parsed} />;
    case 'analyze_deployment_health': return <AnalysisDeploymentHealthCard data={parsed} />;
    case 'analyze_node_pressure': return <AnalysisNodePressureCard data={parsed} />;
    case 'detect_resource_contention': return <AnalysisContentionCard data={parsed} />;
    case 'analyze_network_connectivity': return <AnalysisNetworkCard data={parsed} />;
    case 'analyze_rbac_permissions': return <AnalysisRBACCard data={parsed} />;
    case 'analyze_storage_health': return <AnalysisStorageHealthCard data={parsed} />;
    case 'check_resource_limits': return <AnalysisResourceLimitsCard data={parsed} />;
    case 'analyze_hpa_behavior': return <AnalysisHPACard data={parsed} />;
    case 'analyze_log_patterns': return <AnalysisLogPatternsCard data={parsed} />;
    case 'assess_security_posture': return <AnalysisSecurityPostureCard data={parsed} />;
    case 'detect_configuration_drift': return <AnalysisDriftCard data={parsed} />;
    default:
      return <pre className="text-[10px] leading-relaxed break-all whitespace-pre-wrap text-muted-foreground">{JSON.stringify(parsed, null, 2)}</pre>;
  }
}

// ─── Execution result cards ────────────────────────────────────────────────────

const EXECUTION_TOOLS = new Set([
  'restart_pod', 'scale_deployment', 'cordon_node', 'drain_node',
  'apply_resource_patch', 'delete_resource', 'rollback_deployment',
  'update_resource_limits', 'trigger_hpa_scale',
]);

const RISK_CONFIG: Record<string, { color: string; bg: string; ring: string }> = {
  low: { color: 'text-green-700 dark:text-green-400', bg: 'bg-green-500/12', ring: 'ring-green-500/30' },
  medium: { color: 'text-yellow-700 dark:text-yellow-400', bg: 'bg-yellow-500/12', ring: 'ring-yellow-500/30' },
  high: { color: 'text-orange-700 dark:text-orange-400', bg: 'bg-orange-500/12', ring: 'ring-orange-500/30' },
  critical: { color: 'text-red-700 dark:text-red-400', bg: 'bg-red-500/12', ring: 'ring-red-500/30' },
};

function RiskLevelBadge({ level }: { level: string }) {
  const cfg = RISK_CONFIG[level?.toLowerCase()] ?? RISK_CONFIG.medium;
  return (
    <span className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wide ring-1', cfg.color, cfg.bg, cfg.ring)}>
      <span className={cn('w-1.5 h-1.5 rounded-full', {
        'bg-green-500': level === 'low', 'bg-yellow-500': level === 'medium',
        'bg-orange-500': level === 'high', 'bg-red-500': level === 'critical',
      })} />
      {level ?? 'unknown'}
    </span>
  );
}

interface PolicyCheckRow { policy_name: string; passed: boolean; reason: string; severity: string; }

function PolicyChecksList({ checks }: { checks: PolicyCheckRow[] }) {
  if (!checks?.length) return null;
  return (
    <div className="space-y-1">
      <div className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">Policy Checks ({checks.length})</div>
      <div className="space-y-0.5">
        {checks.map((c, i) => (
          <div key={i} className={cn('flex items-start gap-2 px-2 py-1 rounded text-[10px]', c.passed ? 'bg-green-500/8' : 'bg-red-500/8')}>
            <span className={cn('shrink-0 mt-0.5', c.passed ? 'text-green-500' : 'text-red-500')}>{c.passed ? '✓' : '✗'}</span>
            <div className="flex-1 min-w-0">
              <div className="font-medium truncate">{c.policy_name}</div>
              {c.reason && <div className="text-muted-foreground text-[9px]">{c.reason}</div>}
            </div>
            <span className={cn('shrink-0 text-[9px] font-bold uppercase', {
              'text-red-500': c.severity === 'critical', 'text-orange-500': c.severity === 'high',
              'text-yellow-500': c.severity === 'medium', 'text-green-500': c.severity === 'low',
            })}>{c.severity}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function SafetyGateHeader({ data }: { data: Record<string, unknown> }) {
  const approved = data.approved as boolean;
  const riskLevel = (data.risk_level as string) ?? 'unknown';
  const requiresHuman = data.requires_human as boolean;
  const reason = data.reason as string;
  return (
    <div className={cn('flex items-start gap-3 p-3 rounded-lg',
      approved ? 'bg-green-500/8 border border-green-500/20'
        : requiresHuman ? 'bg-amber-500/8 border border-amber-500/20'
          : 'bg-red-500/8 border border-red-500/20')}>
      <div className={cn('shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-sm',
        approved ? 'bg-green-500/15 text-green-600'
          : requiresHuman ? 'bg-amber-500/15 text-amber-600'
            : 'bg-red-500/15 text-red-600')}>
        {approved ? '✓' : requiresHuman ? '👤' : '✗'}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={cn('text-[11px] font-semibold', {
            'text-green-600 dark:text-green-400': approved,
            'text-amber-600 dark:text-amber-400': !approved && requiresHuman,
            'text-red-600 dark:text-red-400': !approved && !requiresHuman,
          })}>
            {approved ? 'Approved & Executed' : requiresHuman ? 'Requires Human Approval' : 'Denied by Safety Engine'}
          </span>
          <RiskLevelBadge level={riskLevel} />
        </div>
        {reason && <div className="text-[10px] text-muted-foreground mt-0.5 break-words">{reason}</div>}
        {requiresHuman && !approved && (
          <div className="text-[9px] text-amber-600 dark:text-amber-400 mt-1 font-medium">
            ⚡ Action blocked — awaiting explicit operator confirmation
          </div>
        )}
      </div>
    </div>
  );
}

function DryRunBanner() {
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-yellow-500/10 border border-yellow-500/25 text-yellow-700 dark:text-yellow-400">
      <span className="text-[10px]">🔬</span>
      <span className="text-[10px] font-semibold">DRY RUN — No changes were applied to the cluster</span>
    </div>
  );
}

function ExecutionSuccess({ data, label }: { data: Record<string, unknown>; label: string }) {
  const message = data.message as string;
  return (
    <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-green-500/8 border border-green-500/20">
      <span className="text-green-500 shrink-0">✓</span>
      <div className="min-w-0">
        <div className="text-[10px] font-semibold text-green-600 dark:text-green-400">{label}</div>
        {message && <div className="text-[9px] text-muted-foreground mt-0.5">{message}</div>}
      </div>
    </div>
  );
}

function ExecMeta({ items }: { items: Array<{ label: string; value: unknown }> }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.filter(it => it.value !== undefined && it.value !== null && it.value !== '').map((it, i) => (
        <div key={i} className="flex items-center gap-1 px-2 py-0.5 rounded bg-muted/30 border border-border/40">
          <span className="text-[9px] text-muted-foreground">{it.label}</span>
          <span className="text-[10px] font-medium">{String(it.value)}</span>
        </div>
      ))}
    </div>
  );
}

function RestartPodCard({ data }: { data: Record<string, unknown> }) {
  return (
    <div className="space-y-2">
      {data.dry_run && <DryRunBanner />}
      <SafetyGateHeader data={data} />
      {data.approved && !data.dry_run && <ExecutionSuccess data={data} label="Pod restart initiated" />}
      <ExecMeta items={[{ label: 'Pod', value: data.pod as string }, { label: 'Namespace', value: data.namespace as string }]} />
      <PolicyChecksList checks={(data.policy_checks as PolicyCheckRow[]) ?? []} />
    </div>
  );
}

function ScaleDeploymentCard({ data }: { data: Record<string, unknown> }) {
  return (
    <div className="space-y-2">
      {data.dry_run && <DryRunBanner />}
      <SafetyGateHeader data={data} />
      {data.approved && !data.dry_run && <ExecutionSuccess data={data} label={`Deployment scaled to ${data.replicas} replicas`} />}
      <ExecMeta items={[
        { label: 'Deployment', value: data.name as string },
        { label: 'Namespace', value: data.namespace as string },
        { label: 'Replicas', value: data.replicas },
      ]} />
      <PolicyChecksList checks={(data.policy_checks as PolicyCheckRow[]) ?? []} />
    </div>
  );
}

function CordonNodeCard({ data }: { data: Record<string, unknown> }) {
  return (
    <div className="space-y-2">
      {data.dry_run && <DryRunBanner />}
      <SafetyGateHeader data={data} />
      {data.approved && !data.dry_run && <ExecutionSuccess data={data} label="Node cordoned — marked unschedulable" />}
      <ExecMeta items={[{ label: 'Node', value: data.node as string }]} />
      <PolicyChecksList checks={(data.policy_checks as PolicyCheckRow[]) ?? []} />
    </div>
  );
}

function DrainNodeCard({ data }: { data: Record<string, unknown> }) {
  return (
    <div className="space-y-2">
      {data.dry_run && <DryRunBanner />}
      <SafetyGateHeader data={data} />
      {data.approved && !data.dry_run && <ExecutionSuccess data={data} label="Node drained — all pods evicted" />}
      <ExecMeta items={[{ label: 'Node', value: data.node as string }]} />
      {!data.approved && (
        <div className="px-2 py-1.5 rounded bg-amber-500/8 border border-amber-500/20 text-[10px] text-amber-700 dark:text-amber-400">
          ⚠️ Node draining is a high-blast-radius operation. Review policy checks and obtain approval before proceeding.
        </div>
      )}
      <PolicyChecksList checks={(data.policy_checks as PolicyCheckRow[]) ?? []} />
    </div>
  );
}

function ApplyResourcePatchCard({ data }: { data: Record<string, unknown> }) {
  const patch = data.patch as Record<string, unknown> | undefined;
  return (
    <div className="space-y-2">
      {data.dry_run && <DryRunBanner />}
      <SafetyGateHeader data={data} />
      {data.approved && !data.dry_run && <ExecutionSuccess data={data} label="Patch applied successfully" />}
      <ExecMeta items={[{ label: 'Resource', value: data.resource as string }]} />
      {data.dry_run && patch && (
        <div className="space-y-1">
          <div className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">Patch Preview</div>
          <pre className="text-[9px] leading-relaxed bg-muted/20 rounded p-2 overflow-auto max-h-24 text-muted-foreground">
            {JSON.stringify(patch, null, 2)}
          </pre>
        </div>
      )}
      <PolicyChecksList checks={(data.policy_checks as PolicyCheckRow[]) ?? []} />
    </div>
  );
}

function DeleteResourceCard({ data }: { data: Record<string, unknown> }) {
  return (
    <div className="space-y-2">
      {data.dry_run && <DryRunBanner />}
      <SafetyGateHeader data={data} />
      {data.approved && !data.dry_run && <ExecutionSuccess data={data} label="Resource deleted" />}
      <ExecMeta items={[{ label: 'Resource', value: data.resource as string }]} />
      {!data.approved && (
        <div className="px-2 py-1.5 rounded bg-red-500/8 border border-red-500/20 text-[10px] text-red-700 dark:text-red-400">
          🚨 Resource deletion is irreversible. Safety engine requires explicit human confirmation.
        </div>
      )}
      <PolicyChecksList checks={(data.policy_checks as PolicyCheckRow[]) ?? []} />
    </div>
  );
}

function RollbackDeploymentCard({ data }: { data: Record<string, unknown> }) {
  const revision = data.revision;
  return (
    <div className="space-y-2">
      {data.dry_run && <DryRunBanner />}
      <SafetyGateHeader data={data} />
      {data.approved && !data.dry_run && (
        <ExecutionSuccess data={data} label={revision ? `Rolled back to revision ${revision}` : 'Rolled back to previous revision'} />
      )}
      <ExecMeta items={[
        { label: 'Deployment', value: data.name as string },
        { label: 'Namespace', value: data.namespace as string },
        { label: 'Revision', value: revision !== undefined ? String(revision) : 'previous' },
      ]} />
      <PolicyChecksList checks={(data.policy_checks as PolicyCheckRow[]) ?? []} />
    </div>
  );
}

function UpdateResourceLimitsCard({ data }: { data: Record<string, unknown> }) {
  const patch = data.patch as Record<string, unknown> | undefined;
  return (
    <div className="space-y-2">
      {data.dry_run && <DryRunBanner />}
      <SafetyGateHeader data={data} />
      {data.approved && !data.dry_run && <ExecutionSuccess data={data} label="Resource limits updated" />}
      <ExecMeta items={[
        { label: 'Resource', value: data.resource as string },
        { label: 'Container', value: data.container as string },
      ]} />
      {data.dry_run && patch && (
        <div className="space-y-1">
          <div className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">Limits Patch Preview</div>
          <pre className="text-[9px] leading-relaxed bg-muted/20 rounded p-2 overflow-auto max-h-24 text-muted-foreground">
            {JSON.stringify(patch, null, 2)}
          </pre>
        </div>
      )}
      <PolicyChecksList checks={(data.policy_checks as PolicyCheckRow[]) ?? []} />
    </div>
  );
}

function TriggerHPAScaleCard({ data }: { data: Record<string, unknown> }) {
  return (
    <div className="space-y-2">
      {data.dry_run && <DryRunBanner />}
      <SafetyGateHeader data={data} />
      {data.approved && !data.dry_run && <ExecutionSuccess data={data} label={`HPA scaled to ${data.target_replicas} target replicas`} />}
      <ExecMeta items={[
        { label: 'HPA', value: data.hpa as string },
        { label: 'Namespace', value: data.namespace as string },
        { label: 'Target Replicas', value: data.target_replicas },
      ]} />
      <PolicyChecksList checks={(data.policy_checks as PolicyCheckRow[]) ?? []} />
    </div>
  );
}

function ExecutionResultCard({ toolName, resultJson }: { toolName: string; resultJson: string }) {
  let parsed: Record<string, unknown> | null = null;
  try { parsed = JSON.parse(resultJson) as Record<string, unknown>; } catch { /* raw */ }
  if (!parsed) return <pre className="text-[10px] leading-relaxed break-all whitespace-pre-wrap text-muted-foreground">{resultJson}</pre>;
  switch (toolName) {
    case 'restart_pod': return <RestartPodCard data={parsed} />;
    case 'scale_deployment': return <ScaleDeploymentCard data={parsed} />;
    case 'cordon_node': return <CordonNodeCard data={parsed} />;
    case 'drain_node': return <DrainNodeCard data={parsed} />;
    case 'apply_resource_patch': return <ApplyResourcePatchCard data={parsed} />;
    case 'delete_resource': return <DeleteResourceCard data={parsed} />;
    case 'rollback_deployment': return <RollbackDeploymentCard data={parsed} />;
    case 'update_resource_limits': return <UpdateResourceLimitsCard data={parsed} />;
    case 'trigger_hpa_scale': return <TriggerHPAScaleCard data={parsed} />;
    default:
      return <pre className="text-[10px] leading-relaxed break-all whitespace-pre-wrap text-muted-foreground">{JSON.stringify(parsed, null, 2)}</pre>;
  }
}

// ─── ToolEventBubble ───────────────────────────────────────────────────────────

interface ToolEventBubbleProps { event: ToolEvent; }

function ToolEventBubble({ event }: ToolEventBubbleProps) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const isCalling = event.phase === 'calling';
  const isError = event.phase === 'error';
  const isResult = event.phase === 'result';
  const cat = getToolCategory(event.tool_name);
  const CategoryIcon = cat.icon;

  let prettyResult = event.result ?? '';
  let isJson = false;
  if (isResult && prettyResult) {
    try { const p = JSON.parse(prettyResult); prettyResult = JSON.stringify(p, null, 2); isJson = true; } catch { /* raw */ }
  }

  const hasArgs = isCalling && event.args && Object.keys(event.args).length > 0;
  const resultTruncated = prettyResult.length > 200;
  const displayResult = expanded ? prettyResult : prettyResult.slice(0, 200) + (resultTruncated ? '…' : '');

  return (
    <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className="flex justify-start">
      <div className={cn(
        'max-w-[92%] rounded-xl border text-xs font-mono overflow-hidden',
        cat.bgColor, cat.borderColor,
        isError && 'bg-muted/40 border-muted-foreground/20',
      )}>
        {/* Header */}
        <div
          className={cn('flex items-center gap-1.5 px-3 py-2', (isResult || isError) && resultTruncated && 'cursor-pointer hover:opacity-80')}
          onClick={() => (isResult || isError) && setExpanded(e => !e)}
        >
          {isCalling && <Loader2 className={cn('h-3 w-3 animate-spin shrink-0', cat.color)} />}
          {isResult && <CheckCircle className="h-3 w-3 shrink-0 text-green-500" />}
          {isError && <AlertCircle className="h-3 w-3 shrink-0 text-destructive" />}
          <CategoryIcon className={cn('h-3 w-3 shrink-0', cat.color)} />
          <span className={cn('font-semibold truncate max-w-[180px]', cat.color)}>{humanizeToolName(event.tool_name)}</span>
          <span className="text-muted-foreground ml-auto shrink-0">
            {isCalling && 'running…'}{isResult && 'done'}{isError && 'skipped'}
          </span>
          {/* Copy result button */}
          {isResult && event.result && (
            <button
              className="shrink-0 text-muted-foreground hover:text-foreground ml-1 transition-colors"
              onClick={(e) => {
                e.stopPropagation();
                navigator.clipboard.writeText(event.result ?? '');
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              }}
              title="Copy result"
            >
              {copied ? <CheckCircle className="h-3 w-3 text-green-500" /> : <Copy className="h-3 w-3" />}
            </button>
          )}
          {(isResult || isError) && prettyResult.length > 0 && (
            <button
              className="shrink-0 text-muted-foreground hover:text-foreground ml-1"
              onClick={(e) => { e.stopPropagation(); setExpanded(x => !x); }}
            >
              {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            </button>
          )}
        </div>

        {/* Args chips */}
        {hasArgs && (
          <div className="px-3 pb-2 flex flex-wrap gap-1">
            {Object.entries(event.args!).map(([k, v]) => (
              <span key={k} className={cn('px-1.5 py-0.5 rounded text-[10px] border bg-background/50', cat.borderColor, cat.color)}>
                <span className="opacity-60">{k}=</span><span>{JSON.stringify(v)}</span>
              </span>
            ))}
          </div>
        )}

        {/* Result body */}
        {isResult && prettyResult && (
          <div className="px-3 pb-2">
            {DEEP_ANALYSIS_TOOLS.has(event.tool_name) ? (
              <AnalysisResultCard toolName={event.tool_name} resultJson={event.result ?? ''} />
            ) : EXECUTION_TOOLS.has(event.tool_name) ? (
              <ExecutionResultCard toolName={event.tool_name} resultJson={event.result ?? ''} />
            ) : (
              <>
                <pre className={cn('text-[10px] leading-relaxed break-all whitespace-pre-wrap text-muted-foreground',
                  !expanded && 'line-clamp-3', isJson && 'language-json')}>
                  {displayResult}
                </pre>
                {resultTruncated && (
                  <button onClick={() => setExpanded(x => !x)} className={cn('text-[10px] mt-1', cat.color, 'hover:underline')}>
                    {expanded ? 'Show less' : `Show all (${prettyResult.length} chars)`}
                  </button>
                )}
              </>
            )}
          </div>
        )}
        {isError && event.error && (
          <div className="px-3 pb-2">
            {expanded ? (
              <p className="text-muted-foreground break-words text-[11px]">{event.error}</p>
            ) : (
              <button
                type="button"
                onClick={() => setExpanded(true)}
                className="text-[11px] text-muted-foreground hover:text-foreground hover:underline"
              >
                Show error details
              </button>
            )}
          </div>
        )}
      </div>
    </motion.div>
  );
}

// ─── AIAssistant (main) ────────────────────────────────────────────────────────

export function AIAssistant() {
  const { isOpen, isExpanded, context, open, close, toggleExpand, clearContext, consumePendingQuery } = useAIPanelStore();
  const [input, setInput] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const getContext = useRouteContext();

  // Merge store context (from "Ask AI" buttons) with route-derived context
  const routeCtx = getContext();
  const activeContext: AIContext | null = context ?? (routeCtx.resourceName ? {
    resourceKind: routeCtx.resourceKind,
    resourceName: routeCtx.resourceName,
    namespace: routeCtx.namespace,
  } : null);

  const wsUrl = buildChatWSUrl(routeCtx);

  const { messages, isConnected, isConnecting, connect, disconnect, sendUserMessage, clearMessages } = useWebSocket({
    url: wsUrl,
    autoConnect: false,
  });

  // Connect when opened, disconnect when closed
  useEffect(() => {
    if (isOpen) connect(); else disconnect();
  }, [isOpen, connect, disconnect]);

  // Keyboard shortcuts: Cmd+Shift+P toggle, Escape close
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'p') {
        e.preventDefault();
        if (isOpen) close(); else open();
      }
      if (e.key === 'Escape' && isOpen) close();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, open, close]);

  // Auto-focus input when opened
  useEffect(() => {
    if (isOpen && inputRef.current) setTimeout(() => inputRef.current?.focus(), 100);
  }, [isOpen]);

  // Scroll to bottom on new messages
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages]);

  // Consume pending query from store (from "Ask AI" buttons on detail pages)
  useEffect(() => {
    if (isOpen && isConnected) {
      const pending = consumePendingQuery();
      if (pending) sendUserMessage(pending, routeCtx);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, isConnected]);

  const isLoading =
    messages.length > 0 &&
    messages[messages.length - 1].role === 'user' &&
    (isConnecting || isConnected);

  const handleSend = useCallback(() => {
    if (!input.trim() || !isConnected) return;
    const ctx = getContext();
    let msg = input.trim();
    // Prepend context prefix for resource detail pages
    if (activeContext?.resourceName && activeContext?.namespace) {
      msg = `[Context: I am currently viewing ${activeContext.resourceKind || 'resource'} "${activeContext.resourceName}" in namespace "${activeContext.namespace}"]\n\n${msg}`;
    }
    sendUserMessage(msg, ctx);
    setInput('');
  }, [input, isConnected, sendUserMessage, getContext, activeContext]);

  const handleChipClick = useCallback((query: string) => {
    if (!isConnected) {
      setInput(query);
      setTimeout(() => inputRef.current?.focus(), 50);
      return;
    }
    sendUserMessage(query, getContext());
  }, [isConnected, sendUserMessage, getContext]);

  const handleCopy = useCallback((id: string, content: string) => {
    navigator.clipboard.writeText(content);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  }, []);

  return (
    <>
      {/* Floating trigger button */}
      <AnimatePresence>
        {!isOpen && (
          <motion.div
            initial={{ scale: 0, opacity: 0, y: 20 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0, opacity: 0, y: 20 }}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            className="fixed bottom-8 right-8 z-[100] flex flex-col items-center gap-2"
          >
            {/* Pulsing Glow Effect */}
            <motion.div
              animate={{
                scale: [1, 1.2, 1],
                opacity: [0.3, 0.6, 0.3],
              }}
              transition={{
                duration: 4,
                repeat: Infinity,
                ease: "easeInOut"
              }}
              className="absolute inset-0 bg-blue-500/30 rounded-full blur-2xl -z-10"
            />

            <button
              onClick={open}
              className="relative h-16 w-16 rounded-[2rem] shadow-2xl bg-gradient-to-br from-blue-600 via-blue-500 to-indigo-600 border border-white/20 flex items-center justify-center group overflow-hidden"
              aria-label="Activate KOS Intelligence"
            >
              {/* Animated Inner Shine */}
              <motion.div
                animate={{ x: [-100, 100] }}
                transition={{ duration: 3, repeat: Infinity, ease: "linear" }}
                className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent -skew-x-12 w-1/2"
              />

              <div className="relative z-10">
                <AnimatePresence mode="wait">
                  {isConnecting ? (
                    <motion.div key="loader" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                      <Loader2 className="h-7 w-7 text-white animate-spin" />
                    </motion.div>
                  ) : (
                    <motion.div key="bot" initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.8 }}>
                      <Bot className="h-7 w-7 text-white drop-shadow-lg" />
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </button>

            <motion.div
              initial={{ opacity: 0, y: 5 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-slate-900/90 backdrop-blur-md text-[#38BDF8] px-4 py-1.5 rounded-xl text-[11px] font-semibold tracking-wide shadow-xl border border-white/10 flex items-center gap-2"
            >
              <Zap className="h-3.5 w-3.5 fill-[#38BDF8]" />
              KOS Intelligence
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Chat panel */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.95 }}
            transition={{ type: 'spring', stiffness: 300, damping: 30 }}
            role="dialog"
            aria-label="Kubilitics AI Assistant"
            aria-modal="true"
            className={cn(
              'fixed z-[100] flex flex-col bg-card border border-border rounded-2xl shadow-xl overflow-hidden',
              isExpanded ? 'inset-6' : 'bottom-6 right-6 w-[420px] h-[600px] max-h-[80vh]'
            )}
          >
            {/* ── Header ── */}
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-border bg-muted/20 shrink-0">
              <div className="flex items-center gap-2.5">
                <div className="p-1.5 rounded-lg bg-primary/10 shrink-0">
                  <Sparkles className="h-4 w-4 text-primary" />
                </div>
                <h3 className="font-semibold text-sm">Kubilitics AI</h3>
              </div>
              <div className="flex items-center gap-1">
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={toggleExpand}
                  title={isExpanded ? 'Collapse' : 'Expand'}>
                  {isExpanded ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
                </Button>
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={close} title="Close">
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </div>

            {/* ── Context Bar (conditional) ── */}
            {activeContext?.resourceName && (
              <ContextBar
                resourceKind={activeContext.resourceKind ?? ''}
                resourceName={activeContext.resourceName}
                namespace={activeContext.namespace ?? ''}
                onClear={clearContext}
              />
            )}

            {/* ── Message Area ── */}
            <ScrollArea className="flex-1 p-4" ref={scrollRef as React.Ref<HTMLDivElement>}>
              {messages.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full gap-4 px-6 py-12">
                  <div className="p-4 rounded-2xl bg-primary/8 border border-primary/15">
                    <Sparkles className="h-8 w-8 text-primary" />
                  </div>
                  <div className="text-center">
                    <h4 className="font-semibold text-sm mb-1">Kubilitics AI</h4>
                    <p className="text-xs text-muted-foreground max-w-[260px] leading-relaxed">
                      {activeContext?.resourceName
                        ? `Ask me anything about ${activeContext.resourceKind || 'this resource'} "${activeContext.resourceName}".`
                        : 'Ask me anything about your cluster. I can analyze pods, deployments, nodes, security, costs, and more.'}
                    </p>
                    {!isConnected && !isConnecting && (
                      <p className="text-xs text-destructive mt-3">
                        AI service offline — configure your provider in Settings
                      </p>
                    )}
                  </div>
                </div>
              ) : (
                <div className="space-y-4" role="log" aria-live="polite">
                  {messages.map((message, idx) => {
                    if (message.role === 'tool_event' && message.toolEvent) {
                      return <ToolEventBubble key={`tool-${idx}`} event={message.toolEvent} />;
                    }
                    return (
                      <motion.div
                        key={idx}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        className={cn('flex', message.role === 'user' ? 'justify-end' : 'justify-start')}
                      >
                        <div className={cn(
                          'max-w-[85%] rounded-2xl px-4 py-2.5 text-sm',
                          message.role === 'user'
                            ? 'bg-primary text-primary-foreground rounded-br-md'
                            : message.role === 'system'
                              ? 'bg-destructive/10 text-destructive rounded-bl-md text-xs'
                              : 'bg-muted rounded-bl-md'
                        )}>
                          {message.role === 'assistant' ? (
                            <AssistantMessage
                              content={message.content}
                              onCopy={() => handleCopy(String(idx), message.content)}
                              copied={copiedId === String(idx)}
                            />
                          ) : (
                            <div className="whitespace-pre-wrap">{message.content}</div>
                          )}
                        </div>
                      </motion.div>
                    );
                  })}

                  {isLoading && (
                    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex justify-start">
                      <div className="bg-muted rounded-2xl rounded-bl-md px-4 py-3">
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                          <Loader2 className="h-4 w-4 animate-spin" />
                          Thinking…
                        </div>
                      </div>
                    </motion.div>
                  )}
                </div>
              )}
            </ScrollArea>

            {/* ── Quick Action Chips ── */}
            <QuickActionChips
              screen={routeCtx.screen}
              resourceName={activeContext?.resourceName}
              namespace={activeContext?.namespace}
              onChipClick={handleChipClick}
            />

            {/* ── Input Area ── */}
            <div className="p-4 border-t border-border bg-muted/20 shrink-0">
              {!isConnected && !isConnecting && (
                <div className="flex items-center gap-2 mb-2 text-xs text-muted-foreground">
                  <Wifi className="h-3.5 w-3.5 text-destructive" />
                  <span>AI service offline. Check Settings → AI Configuration.</span>
                </div>
              )}
              <div className="flex items-center gap-2">
                <input
                  ref={inputRef}
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
                  }}
                  placeholder={isConnected ? 'Ask anything about your cluster…' : 'Connect AI service first…'}
                  aria-label="Message Kubilitics AI"
                  className="flex-1 bg-background border border-input rounded-xl px-4 py-2.5 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
                  disabled={!isConnected}
                />
                <Button
                  onClick={handleSend}
                  disabled={!input.trim() || !isConnected}
                  size="icon"
                  className="h-10 w-10 rounded-xl shrink-0"
                  aria-label="Send message"
                >
                  <Send className="h-4 w-4" />
                </Button>
              </div>
            </div>

            {/* ── AI Status Footer ── */}
            <AIStatusFooter
              isConnected={isConnected}
              isConnecting={isConnecting}
              onReconnect={connect}
              onClearMessages={clearMessages}
              hasMessages={messages.length > 0}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
