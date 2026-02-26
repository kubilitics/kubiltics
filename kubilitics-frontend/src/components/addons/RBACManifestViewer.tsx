import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { useBackendClient } from '@/hooks/useBackendClient';
import { Button } from '@/components/ui/button';
import { Shield, Copy, Check, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { useToast } from '@/hooks/use-toast';

interface RBACManifestViewerProps {
    clusterId: string;
    addonId: string;
    namespace: string;
}

/**
 * T5.23: RBACManifestViewer component
 * Fetches and displays the raw K8s RBAC YAML required by an add-on.
 */
export function RBACManifestViewer({ clusterId, addonId, namespace }: RBACManifestViewerProps) {
    const client = useBackendClient();
    const [copied, setCopied] = useState(false);
    const { toast } = useToast();

    const { data: yaml, isLoading, error } = useQuery({
        queryKey: ['addon-rbac', clusterId, addonId, namespace],
        queryFn: () => client.getAddonRBACManifest(clusterId, addonId, namespace),
    });

    const handleCopy = () => {
        if (!yaml) return;
        navigator.clipboard.writeText(yaml);
        setCopied(true);
        toast({
            title: "Copied to clipboard",
            description: "RBAC manifest YAML has been copied.",
        });
        setTimeout(() => setCopied(false), 2000);
    };

    if (isLoading) {
        return (
            <div className="flex flex-col items-center justify-center p-12 gap-2 text-muted-foreground border rounded-xl bg-muted/10">
                <Loader2 className="h-6 w-6 animate-spin" />
                <span className="text-xs">Generating RBAC manifest...</span>
            </div>
        );
    }

    if (error || !yaml) {
        return (
            <div className="p-8 text-center border rounded-xl bg-destructive/5 border-destructive/10">
                <Shield className="h-8 w-8 text-destructive opacity-30 mx-auto mb-2" />
                <p className="text-sm font-medium text-destructive">Failed to load RBAC manifest</p>
                <p className="text-xs text-muted-foreground mt-1">Make sure the backend is reachable and the addon exists.</p>
            </div>
        );
    }

    return (
        <div className="flex flex-col gap-4">
            <div className="flex justify-between items-center">
                <div className="flex items-center gap-2 text-sm font-semibold">
                    <Shield className="h-4 w-4 text-primary" />
                    Security Manifest (RBAC)
                </div>
                <Button variant="outline" size="sm" onClick={handleCopy} className="h-8 gap-2">
                    {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
                    {copied ? 'Copied' : 'Copy YAML'}
                </Button>
            </div>

            <div className="relative group">
                <pre className="p-4 rounded-xl bg-zinc-950 text-zinc-300 text-[10px] font-mono overflow-x-auto border border-zinc-800 leading-relaxed max-h-[400px]">
                    {yaml}
                </pre>
                <div className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Badge variant="outline" className="bg-zinc-900 text-zinc-500 border-zinc-700 text-[9px] uppercase tracking-widest font-bold">
                        YAML
                    </Badge>
                </div>
            </div>

            <p className="text-[10px] text-muted-foreground italic">
                Note: This manifest contains the ClusterRoles and Bindings required for {addonId} to operate in {namespace}.
            </p>
        </div>
    );
}

function Badge({ children, className, variant }: any) {
    return <span className={`px-2 py-0.5 rounded text-xs font-medium ${className}`}>{children}</span>;
}
