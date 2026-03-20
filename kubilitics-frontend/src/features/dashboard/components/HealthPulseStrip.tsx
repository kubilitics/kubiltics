import React from "react";
import { Activity, Server, Box, AlertTriangle, ShieldCheck } from "lucide-react";

// @ts-ignore
const PulseItem = ({ icon: Icon, label, value, colorClass, delay }: any) => (
    <div className={`flex items-center gap-3 px-6 border-r border-white/5 last:border-0 animate-fade-in`} style={{ animationDelay: `${delay}ms` }}>
        <div className={`p-2 rounded-lg bg-white/5 ${colorClass}`}>
            <Icon className="w-4 h-4" />
        </div>
        <div>
            <div className="text-xs text-muted-foreground uppercase tracking-wider font-medium">{label}</div>
            <div className="text-lg font-bold font-mono text-foreground leading-none mt-0.5">{value}</div>
        </div>
    </div>
);

export const HealthPulseStrip = () => {
    return (
        <div className="h-16 w-full flex items-center bg-deep-stage/30 border-b border-white/5 backdrop-blur-sm overflow-x-auto no-scrollbar">
            <PulseItem icon={Server} label="Clusters" value="3" colorClass="text-cosmic-blue" delay={0} />
            <PulseItem icon={Box} label="Nodes" value="48" colorClass="text-cosmic-cyan" delay={100} />
            <PulseItem icon={Activity} label="Pods" value="1,240" colorClass="text-signal-success" delay={200} />
            <PulseItem icon={AlertTriangle} label="Alerts" value="2" colorClass="text-signal-warning animate-pulse" delay={300} />
            <PulseItem icon={ShieldCheck} label="Health" value="98%" colorClass="text-signal-success" delay={400} />

            <div className="ml-auto px-6 flex items-center gap-2 text-xs text-muted-foreground">
                <span className="w-2 h-2 rounded-full bg-signal-success animate-pulse-glow" />
                <span className="opacity-80">System Operational</span>
            </div>
        </div>
    );
};
