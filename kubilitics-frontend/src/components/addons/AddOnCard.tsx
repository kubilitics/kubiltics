import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { AddOnEntry } from "@/types/api/addons";
import { Button } from "@/components/ui/button";
import {
    Package, ArrowRight,
    CheckCircle2, AlertTriangle, Sparkles, ShieldCheck, Globe, Lock, Star
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

// ─── Logo component with graceful fallback ────────────────────────────────────
// Shows real logo image; falls back to styled initials only when no icon is available.
function AddonLogo({ entry }: { entry: AddOnEntry }) {
    const [err, setErr] = useState(false);

    if (entry.icon_url && !err) {
        return (
            <img
                src={entry.icon_url}
                alt={entry.display_name}
                className="w-full h-full object-contain p-1"
                onError={() => setErr(true)}
                loading="lazy"
            />
        );
    }

    // Fallback: brand-colored background with initial letter
    // We use a deterministic but tasteful color derived from the name
    const colors = [
        ["bg-[#E87040]", "text-white"],  // orange (Argo-style)
        ["bg-[#316CE8]", "text-white"],  // blue (cert-manager style)
        ["bg-[#00BCD4]", "text-white"],  // cyan
        ["bg-[#E53935]", "text-white"],  // red (Falco style)
        ["bg-[#43A047]", "text-white"],  // green
        ["bg-[#7B1FA2]", "text-white"],  // purple (kyverno style)
        ["bg-[#F57C00]", "text-white"],  // amber
        ["bg-[#00897B]", "text-white"],  // teal
        ["bg-[#1565C0]", "text-white"],  // deep blue
        ["bg-[#6D4C41]", "text-white"],  // brown
    ];
    let h = 0;
    for (let i = 0; i < entry.name.length; i++) h = entry.name.charCodeAt(i) + ((h << 5) - h);
    const [bg, fg] = colors[Math.abs(h) % colors.length];

    const words = entry.display_name.split(/[-\s_/]+/).filter(Boolean);
    const letter = words.length >= 2
        ? (words[0][0] + words[1][0]).toUpperCase()
        : entry.display_name.slice(0, 2).toUpperCase();

    return (
        <div className={cn("w-full h-full rounded-xl flex items-center justify-center font-black text-2xl select-none", bg, fg)}>
            {letter || <Package className="h-6 w-6" />}
        </div>
    );
}

// ─── Tier badge pill (compact: icon-only for Verified to save space) ───────────
function TierBadge({ tier }: { tier: string }) {
    if (tier === "CORE") {
        return (
            <TooltipProvider>
                <Tooltip>
                    <TooltipTrigger asChild>
                        <div className="flex items-center justify-center w-6 h-5 rounded-full bg-blue-500/10 border border-blue-500/20 cursor-help">
                            <ShieldCheck className="h-3 w-3 text-blue-500 shrink-0" />
                        </div>
                    </TooltipTrigger>
                    <TooltipContent>Verified</TooltipContent>
                </Tooltip>
            </TooltipProvider>
        );
    }
    if (tier === "COMMUNITY") {
        return (
            <TooltipProvider>
                <Tooltip>
                    <TooltipTrigger asChild>
                        <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-muted border border-border/60 cursor-help">
                            <Globe className="h-3 w-3 text-muted-foreground shrink-0" />
                            <span className="text-[10px] font-bold text-muted-foreground tracking-wide">Community</span>
                        </div>
                    </TooltipTrigger>
                    <TooltipContent>Community-sourced from ArtifactHub</TooltipContent>
                </Tooltip>
            </TooltipProvider>
        );
    }
    return (
        <TooltipProvider>
            <Tooltip>
                <TooltipTrigger asChild>
                    <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-purple-500/10 border border-purple-500/20 cursor-help">
                        <Lock className="h-3 w-3 text-purple-500 shrink-0" />
                        <span className="text-[10px] font-bold text-purple-600 dark:text-purple-400 tracking-wide">Private</span>
                    </div>
                </TooltipTrigger>
                <TooltipContent>Enterprise private registry</TooltipContent>
            </Tooltip>
        </TooltipProvider>
    );
}

// ─── Extract short maintainer label ──────────────────────────────────────────
function extractMaintainer(entry: AddOnEntry): string | null {
    if (entry.maintainer) return entry.maintainer;
    try {
        const host = new URL(entry.helm_repo_url).hostname;
        return host.replace(/^charts\./, "").split(".")[0] || null;
    } catch {
        return null;
    }
}

// ─── Props ────────────────────────────────────────────────────────────────────
interface AddOnCardProps {
    entry: AddOnEntry;
    isInstalled?: boolean;
    installedVersion?: string;
    isRecommendation?: boolean;
    recommendationReason?: string;
    priority?: 'high' | 'medium' | 'low';
}

// ─── Card ─────────────────────────────────────────────────────────────────────
// Layout: ArtifactHub style — logo left, title+meta right, description below, action footer.
export function AddOnCard({
    entry,
    isInstalled,
    installedVersion,
    isRecommendation,
    recommendationReason,
    priority,
}: AddOnCardProps) {
    const navigate = useNavigate();
    const maintainer = extractMaintainer(entry);
    const versionLabel = entry.version || entry.helm_chart_version || "";

    return (
        <article
            className={cn(
                "group relative flex flex-col rounded-2xl overflow-hidden cursor-pointer",
                "bg-card border border-border/60 hover:border-primary/40",
                "shadow-sm hover:shadow-lg hover:shadow-primary/5",
                "transition-all duration-200",
                entry.is_deprecated && "opacity-70"
            )}
            onClick={() => navigate(`/addons/${encodeURIComponent(entry.id)}`)}
        >
            {/* — Recommendation ribbon — */}
            {isRecommendation && (
                <div className={cn(
                    "px-4 py-2 flex items-center gap-2 border-b border-border/30",
                    priority === "high" ? "bg-amber-500/8" : "bg-primary/5"
                )}>
                    <Sparkles className={cn(
                        "h-3 w-3 shrink-0",
                        priority === "high" ? "text-amber-500" : "text-primary"
                    )} />
                    <p className="text-[11px] font-semibold text-foreground/70 leading-snug line-clamp-1">
                        {recommendationReason}
                    </p>
                </div>
            )}

            {/* — Main content — */}
            <div className="p-5 flex-1 flex flex-col gap-4">

                {/* Header: logo + title + meta */}
                <div className="flex items-start gap-4">
                    {/* Logo container — white/card background, like ArtifactHub */}
                    <div className={cn(
                        "shrink-0 w-[72px] h-[72px] rounded-2xl overflow-hidden",
                        "bg-white dark:bg-white/5",
                        "border border-border/40 shadow-sm",
                        "flex items-center justify-center"
                    )}>
                        <AddonLogo entry={entry} />
                    </div>

                    {/* Title + meta */}
                    <div className="flex-1 min-w-0 pt-0.5">
                        {/* Name */}
                        <h3 className="font-bold text-[15px] leading-tight text-foreground group-hover:text-primary transition-colors line-clamp-1 pr-6">
                            {entry.display_name}
                        </h3>

                        {/* Version · Maintainer */}
                        <div className="flex items-center gap-1.5 mt-1.5 text-[12px] text-muted-foreground">
                            {versionLabel && (
                                <span className="font-mono font-medium text-foreground/60 shrink-0">
                                    v{versionLabel.replace(/^v/, "")}
                                </span>
                            )}
                            {maintainer && versionLabel && (
                                <span className="text-border">·</span>
                            )}
                            {maintainer && (
                                <span className="truncate" title={maintainer}>{maintainer}</span>
                            )}
                        </div>

                        {/* Tier badge + stars */}
                        <div className="mt-2 flex items-center gap-2 flex-wrap">
                            <TierBadge tier={entry.tier} />
                            {typeof entry.stars === "number" && entry.stars > 0 && (
                                <span className="flex items-center gap-0.5 text-[11px] text-muted-foreground font-medium" title="Artifact Hub stars">
                                    <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
                                    {entry.stars >= 1000 ? `${(entry.stars / 1000).toFixed(1)}k` : entry.stars}
                                </span>
                            )}
                        </div>
                    </div>

                    {/* Top-right: installed check */}
                    {isInstalled && (
                        <div
                            className="absolute top-4 right-4 h-6 w-6 rounded-full bg-emerald-500 flex items-center justify-center shadow-sm"
                            title={`Installed${installedVersion ? ` (v${installedVersion})` : ""}`}
                        >
                            <CheckCircle2 className="h-3.5 w-3.5 text-white" />
                        </div>
                    )}
                </div>

                {/* Description */}
                <p className="text-[12.5px] text-muted-foreground leading-relaxed line-clamp-3 flex-1">
                    {entry.description}
                </p>

                {/* Tags */}
                {entry.tags && entry.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                        {entry.tags.slice(0, 3).map(tag => (
                            <span
                                key={tag}
                                className="px-2 py-0.5 rounded-md bg-muted text-muted-foreground text-[10px] font-semibold uppercase tracking-wider border border-border/40"
                            >
                                {tag}
                            </span>
                        ))}
                    </div>
                )}
            </div>

            {/* — Deprecated banner — */}
            {entry.is_deprecated && (
                <div className="px-5 py-2 bg-amber-500/8 border-t border-amber-500/20 flex items-center gap-2">
                    <AlertTriangle className="h-3 w-3 text-amber-500 shrink-0" />
                    <span className="text-[10px] font-bold text-amber-600 dark:text-amber-400 uppercase tracking-wider">Deprecated</span>
                </div>
            )}

            {/* — Footer — */}
            <div className="px-5 py-3.5 border-t border-border/40 bg-muted/20 flex items-center justify-between gap-3 mt-auto">
                <Button
                    size="sm"
                    variant={isInstalled ? "outline" : "default"}
                    className={cn(
                        "h-8 px-4 text-xs font-semibold rounded-lg transition-all",
                        isInstalled
                            ? "border-emerald-500/30 text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 hover:bg-emerald-500/20 pointer-events-none"
                            : "shadow-sm"
                    )}
                    onClick={(e) => {
                        e.stopPropagation();
                        if (!isInstalled) navigate(`/addons/${encodeURIComponent(entry.id)}`);
                    }}
                >
                    {isInstalled ? (
                        <><CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />Installed</>
                    ) : "Install"}
                </Button>

                <button
                    className="text-[12px] text-muted-foreground hover:text-primary font-semibold flex items-center gap-1 transition-colors group/link"
                    onClick={(e) => { e.stopPropagation(); navigate(`/addons/${encodeURIComponent(entry.id)}`); }}
                >
                    Learn More
                    <ArrowRight className="h-3.5 w-3.5 group-hover/link:translate-x-0.5 transition-transform" />
                </button>
            </div>
        </article>
    );
}
