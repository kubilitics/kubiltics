import { Badge } from "@/components/ui/badge";
import { AddOnStatus } from "@/types/api/addons";
import { cn } from "@/lib/utils";
import {
    CheckCircle2, AlertCircle, RefreshCw, XCircle,
    Clock, AlertTriangle, PauseCircle, Trash2
} from "lucide-react";

interface AddOnStatusBadgeProps {
    status: AddOnStatus;
}

export function AddOnStatusBadge({ status }: AddOnStatusBadgeProps) {
    const config: Record<AddOnStatus, { label: string; icon: any; className: string }> = {
        INSTALLING: {
            label: "Installing",
            icon: RefreshCw,
            className: "bg-blue-50 text-blue-600 border-blue-200 animate-spin-slow",
        },
        INSTALLED: {
            label: "Healthy",
            icon: CheckCircle2,
            className: "bg-emerald-50 text-emerald-600 border-emerald-200",
        },
        DEGRADED: {
            label: "Degraded",
            icon: AlertTriangle,
            className: "bg-amber-50 text-amber-600 border-amber-200",
        },
        UPGRADING: {
            label: "Upgrading",
            icon: RefreshCw,
            className: "bg-blue-50 text-blue-600 border-blue-200 animate-spin-slow",
        },
        ROLLING_BACK: {
            label: "Rolling Back",
            icon: Clock,
            className: "bg-orange-50 text-orange-600 border-orange-200",
        },
        FAILED: {
            label: "Failed",
            icon: XCircle,
            className: "bg-red-50 text-red-600 border-red-200",
        },
        DRIFTED: {
            label: "Drifted",
            icon: AlertCircle,
            className: "bg-amber-50 text-amber-600 border-amber-200 border-dashed",
        },
        SUSPENDED: {
            label: "Suspended",
            icon: PauseCircle,
            className: "bg-slate-50 text-slate-600 border-slate-200",
        },
        DEPRECATED: {
            label: "Deprecated",
            icon: Trash2,
            className: "bg-slate-100 text-slate-500 border-slate-300",
        },
        UNINSTALLING: {
            label: "Uninstalling",
            icon: RefreshCw,
            className: "bg-slate-50 text-slate-600 border-slate-200 animate-spin-slow",
        },
    };

    const { label, icon: Icon, className } = config[status] || {
        label: status,
        icon: AlertCircle,
        className: "bg-muted text-muted-foreground",
    };

    return (
        <Badge variant="outline" className={cn("flex gap-1.5 items-center px-2 py-0.5", className)}>
            <Icon className="h-3 w-3" />
            <span className="text-[11px] font-semibold">{label}</span>
        </Badge>
    );
}
