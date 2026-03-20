import React from "react";
import { Clock, CheckCircle2, XCircle, PlayCircle, FileText } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";

const activities = [
    {
        type: "deployment",
        status: "success",
        message: "Deployed api-gateway v2.4.0",
        user: "koti",
        time: "2m ago",
        icon: CheckCircle2,
        color: "text-signal-success"
    },
    {
        type: "alert",
        status: "error",
        message: "Pod payment-service-x829 crashed (OOMKilled)",
        user: "system",
        time: "15m ago",
        icon: XCircle,
        color: "text-signal-error"
    },
    {
        type: "job",
        status: "running",
        message: "Started cronjob database-backup",
        user: "system",
        time: "1h ago",
        icon: PlayCircle,
        color: "text-cosmic-blue"
    },
    {
        type: "config",
        status: "info",
        message: "Updated configmap global-settings",
        user: "alice",
        time: "2h ago",
        icon: FileText,
        color: "text-muted-foreground"
    }
];

export const ActivityFeed = () => {
    return (
        <div className="h-full w-full flex flex-col">
            <div className="p-4 border-b border-white/5 flex items-center justify-between sticky top-0 bg-deep-stage/50 backdrop-blur-md z-10">
                <h3 className="font-semibold text-sm tracking-wide">Activity Feed</h3>
                <Clock className="w-4 h-4 text-muted-foreground" />
            </div>

            <div className="flex-1 overflow-y-auto p-0">
                {activities.map((item, idx) => (
                    <div key={idx} className="group flex gap-3 p-4 border-b border-white/5 hover:bg-white/5 transition-colors cursor-pointer">
                        <div className={`mt-0.5 ${item.color}`}>
                            <item.icon className="w-4 h-4" />
                        </div>
                        <div className="flex-1 min-w-0">
                            <p className="text-xs font-medium text-foreground truncate">{item.message}</p>
                            <div className="flex items-center gap-2 mt-1">
                                <span className="text-[10px] text-muted-foreground bg-white/5 px-1.5 py-0.5 rounded border border-white/5">{item.user}</span>
                                <span className="text-[10px] text-muted-foreground">{item.time}</span>
                            </div>
                        </div>
                    </div>
                ))}
                {/* Fillers */}
                {Array.from({ length: 5 }).map((_, i) => (
                    <div key={`filler-${i}`} className="p-4 border-b border-white/5 opacity-30">
                        <div className="h-3 w-3/4 bg-white/10 rounded mb-2" />
                        <div className="h-2 w-1/2 bg-white/5 rounded" />
                    </div>
                ))}
            </div>
        </div>
    );
};
