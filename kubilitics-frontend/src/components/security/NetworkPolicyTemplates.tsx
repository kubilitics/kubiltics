/**
 * NetworkPolicyTemplates — ENT-002
 *
 * Template gallery showing pre-built network policy templates.
 * Users can browse, preview YAML, customize namespace, and apply
 * templates to their clusters.
 */

import { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Shield,
  Search,
  Eye,
  Copy,
  Download,
  Play,
  X,
  Filter,
  Network,
  Globe,
  Wifi,
  Monitor,
  Lock,
} from 'lucide-react';
import { toast } from '@/components/ui/sonner';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import {
  NETWORK_POLICY_TEMPLATES,
  renderTemplate,
  searchTemplates,
  type NetworkPolicyTemplate,
} from '@/lib/networkPolicyTemplates';
import { useBackendConfigStore } from '@/stores/backendConfigStore';
import { useClusterStore } from '@/stores/clusterStore';

// ─── Category icons ──────────────────────────────────────────

const CATEGORY_ICONS: Record<string, React.ElementType> = {
  isolation: Lock,
  allow: Globe,
  monitoring: Monitor,
  dns: Wifi,
};

const SEVERITY_COLORS: Record<string, string> = {
  critical: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  high: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
  medium: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400',
  low: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
};

// ─── Component ───────────────────────────────────────────────

export default function NetworkPolicyTemplates() {
  const backendBaseUrl = useBackendConfigStore((s) => s.backendBaseUrl);
  const activeNamespace = useClusterStore((s) => s.activeNamespace);

  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [previewTemplate, setPreviewTemplate] = useState<NetworkPolicyTemplate | null>(null);
  const [targetNamespace, setTargetNamespace] = useState(activeNamespace || 'default');
  const [isApplying, setIsApplying] = useState(false);

  const filteredTemplates = useMemo(() => {
    let results = searchQuery ? searchTemplates(searchQuery) : NETWORK_POLICY_TEMPLATES;
    if (categoryFilter !== 'all') {
      results = results.filter((t) => t.category === categoryFilter);
    }
    return results;
  }, [searchQuery, categoryFilter]);

  function handleCopyYaml(template: NetworkPolicyTemplate) {
    const yaml = renderTemplate(template, targetNamespace);
    navigator.clipboard.writeText(yaml).then(() => {
      toast.success('YAML copied to clipboard');
    });
  }

  function handleDownloadYaml(template: NetworkPolicyTemplate) {
    const yaml = renderTemplate(template, targetNamespace);
    const blob = new Blob([yaml], { type: 'application/x-yaml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${template.id}.yaml`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('YAML downloaded');
  }

  async function handleApply(template: NetworkPolicyTemplate) {
    setIsApplying(true);
    try {
      const yaml = renderTemplate(template, targetNamespace);
      const res = await fetch(`${backendBaseUrl}/api/v1/apply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ manifest: yaml }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(body.error || `Apply failed: ${res.statusText}`);
      }
      toast.success(`Network policy "${template.name}" applied to namespace "${targetNamespace}"`);
      setPreviewTemplate(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to apply network policy');
    } finally {
      setIsApplying(false);
    }
  }

  const categories = [
    { value: 'all', label: 'All Categories' },
    { value: 'isolation', label: 'Isolation' },
    { value: 'allow', label: 'Allow Rules' },
    { value: 'dns', label: 'DNS' },
    { value: 'monitoring', label: 'Monitoring' },
  ];

  return (
    <>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Network className="h-6 w-6 text-primary" />
            <div>
              <h2 className="text-xl font-semibold">Network Policy Templates</h2>
              <p className="text-sm text-muted-foreground">
                Pre-built network policy templates for common security patterns
              </p>
            </div>
          </div>
          <Badge variant="outline">{NETWORK_POLICY_TEMPLATES.length} templates</Badge>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-3">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search templates..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
            />
          </div>
          <Select value={categoryFilter} onValueChange={setCategoryFilter}>
            <SelectTrigger className="w-[180px]">
              <Filter className="h-4 w-4 mr-2" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {categories.map((cat) => (
                <SelectItem key={cat.value} value={cat.value}>
                  {cat.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="flex items-center gap-2">
            <Label className="text-sm text-muted-foreground whitespace-nowrap">Target NS:</Label>
            <Input
              value={targetNamespace}
              onChange={(e) => setTargetNamespace(e.target.value)}
              className="w-[140px]"
              placeholder="default"
            />
          </div>
        </div>

        {/* Template Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <AnimatePresence mode="popLayout">
            {filteredTemplates.map((template) => {
              const CategoryIcon = CATEGORY_ICONS[template.category] ?? Shield;
              return (
                <motion.div
                  key={template.id}
                  layout
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  transition={{ duration: 0.2 }}
                >
                  <Card className="h-full flex flex-col hover:border-primary/40 transition-colors">
                    <CardHeader className="pb-3">
                      <div className="flex items-start justify-between">
                        <div className="flex items-center gap-2">
                          <CategoryIcon className="h-4 w-4 text-primary shrink-0" />
                          <CardTitle className="text-sm">{template.name}</CardTitle>
                        </div>
                        <Badge className={cn('text-xs', SEVERITY_COLORS[template.severity])}>
                          {template.severity}
                        </Badge>
                      </div>
                      <CardDescription className="text-xs leading-relaxed">
                        {template.description}
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="pt-0 mt-auto space-y-3">
                      <div className="flex flex-wrap gap-1">
                        {template.tags.map((tag) => (
                          <Badge key={tag} variant="outline" className="text-xs px-1.5 py-0">
                            {tag}
                          </Badge>
                        ))}
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          className="flex-1"
                          onClick={() => setPreviewTemplate(template)}
                        >
                          <Eye className="h-3.5 w-3.5 mr-1" />
                          Preview
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleCopyYaml(template)}
                        >
                          <Copy className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleDownloadYaml(template)}
                        >
                          <Download className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>

        {filteredTemplates.length === 0 && (
          <div className="text-center py-12 text-muted-foreground">
            <Shield className="h-12 w-12 mx-auto mb-3 opacity-30" />
            <p className="text-sm">No templates match your search</p>
          </div>
        )}
      </div>

      {/* Preview Dialog */}
      <Dialog open={!!previewTemplate} onOpenChange={(open) => !open && setPreviewTemplate(null)}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Shield className="h-5 w-5 text-primary" />
              {previewTemplate?.name}
            </DialogTitle>
            <DialogDescription>
              Review the YAML manifest before applying to namespace "{targetNamespace}"
            </DialogDescription>
          </DialogHeader>
          <div className="flex-1 overflow-auto">
            <pre className="bg-muted rounded-lg p-4 text-xs font-mono leading-relaxed overflow-x-auto whitespace-pre">
              {previewTemplate ? renderTemplate(previewTemplate, targetNamespace) : ''}
            </pre>
          </div>
          <DialogFooter className="flex items-center gap-2">
            <Button variant="outline" onClick={() => previewTemplate && handleCopyYaml(previewTemplate)}>
              <Copy className="h-4 w-4 mr-2" />
              Copy
            </Button>
            <Button variant="outline" onClick={() => previewTemplate && handleDownloadYaml(previewTemplate)}>
              <Download className="h-4 w-4 mr-2" />
              Download
            </Button>
            <Button
              onClick={() => previewTemplate && handleApply(previewTemplate)}
              disabled={isApplying}
            >
              {isApplying ? (
                <span className="flex items-center">
                  <svg className="animate-spin h-4 w-4 mr-2" viewBox="0 0 24 24">
                    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" className="opacity-25" />
                    <path fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 100 8v4a8 8 0 01-8-8z" className="opacity-75" />
                  </svg>
                  Applying...
                </span>
              ) : (
                <>
                  <Play className="h-4 w-4 mr-2" />
                  Apply to Cluster
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
