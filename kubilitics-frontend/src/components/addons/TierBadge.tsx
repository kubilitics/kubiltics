import { Badge } from "@/components/ui/badge";
import { ShieldCheck, Globe, Lock } from "lucide-react";
import { AddOnTier } from "@/types/api/addons";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface TierBadgeProps {
    tier: AddOnTier;
    size?: "sm" | "md";
}

export function TierBadge({ tier, size = "md" }: TierBadgeProps) {
    const config = {
        CORE: {
            label: "", // compact: icon-only with tooltip
            icon: <ShieldCheck className={cn("text-blue-600", size === "sm" ? "h-3 w-3" : "h-4 w-4")} />,
            className: "bg-blue-600 text-white border-blue-700 shadow-sm px-1.5",
            tooltip: "Verified",
        },
        COMMUNITY: {
            label: "Community",
            icon: <Globe className={cn("text-slate-500", size === "sm" ? "h-3 w-3" : "h-4 w-4")} />,
            className: "bg-slate-500/10 text-slate-600 border-slate-200 hover:bg-slate-500/20",
            tooltip: "Trusted community add-on. Performance may vary.",
        },
        PRIVATE: {
            label: "Private",
            icon: <Lock className={cn("text-purple-500", size === "sm" ? "h-3 w-3" : "h-4 w-4")} />,
            className: "bg-purple-500/10 text-purple-600 border-purple-200 hover:bg-purple-500/20",
            tooltip: "Internally managed or enterprise-private add-on.",
        },
    };

    const { label, icon, className, tooltip } = config[tier];

    return (
        <TooltipProvider>
            <Tooltip>
                <TooltipTrigger asChild>
                    <Badge variant="outline" className={cn("flex gap-1.5 items-center font-medium", className, !label && "gap-0")}>
                        {icon}
                        {label ? <span className={size === "sm" ? "text-[10px]" : "text-xs"}>{label}</span> : null}
                    </Badge>
                </TooltipTrigger>
                <TooltipContent>
                    <p className="max-w-[200px] text-xs">{tooltip}</p>
                </TooltipContent>
            </Tooltip>
        </TooltipProvider>
    );
}
