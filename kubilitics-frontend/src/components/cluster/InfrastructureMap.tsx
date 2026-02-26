import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Server, Activity, ShieldCheck, Cpu, HardDrive } from 'lucide-react';
import { cn } from '@/lib/utils';

interface NodeStatus {
    name: string;
    status: 'Ready' | 'NotReady';
}

interface InfrastructureMapProps {
    nodes: NodeStatus[];
}

export function InfrastructureMap({ nodes }: InfrastructureMapProps) {
    const navigate = useNavigate();

    // Dynamic sizing logic based on node density
    const getUnitStyles = (count: number) => {
        if (count <= 4) return {
            container: "h-28 w-28 gap-2",
            icon: "h-10 w-10",
            label: "text-[9px]",
            telemetry: "w-16 h-1.5",
            gridSize: "40px"
        };
        if (count <= 12) return {
            container: "h-20 w-20 gap-1.5",
            icon: "h-8 w-8",
            label: "text-[7px]",
            telemetry: "w-12 h-1",
            gridSize: "32px"
        };
        return {
            container: "h-14 w-14 gap-1",
            icon: "h-6 w-6",
            label: "hidden",
            telemetry: "hidden",
            gridSize: "24px"
        };
    };

    const s = getUnitStyles(nodes.length);

    return (
        <div className="w-full relative min-h-[220px] p-8 rounded-[2rem] bg-slate-50/30 border border-slate-100/50 overflow-hidden flex items-center justify-center">
            {/* Background Grid Pattern - Adaptive */}
            <div className="absolute inset-0 opacity-[0.04] pointer-events-none"
                style={{
                    backgroundImage: 'radial-gradient(#326CE5 1.5px, transparent 1.5px)',
                    backgroundSize: s.gridSize
                }} />

            <div className="flex flex-wrap gap-8 relative z-10 justify-center items-center max-w-4xl mx-auto">
                <AnimatePresence>
                    {nodes.map((node, i) => (
                        <motion.div
                            key={node.name}
                            initial={{ scale: 0.8, opacity: 0, y: 20 }}
                            animate={{ scale: 1, opacity: 1, y: 0 }}
                            exit={{ scale: 0.8, opacity: 0 }}
                            transition={{
                                delay: i * 0.08,
                                type: 'spring',
                                stiffness: 200,
                                damping: 15
                            }}
                            className="relative group"
                        >
                            {/* Compute Unit Card */}
                            <button
                                onClick={() => navigate(`/nodes/${node.name}`)}
                                className={cn(
                                    "relative rounded-3xl flex flex-col items-center justify-center border-2 transition-all duration-700 cursor-pointer overflow-hidden bg-white/80 backdrop-blur-sm shadow-xl shadow-slate-200/50",
                                    s.container,
                                    node.status === 'Ready'
                                        ? "border-[#326CE5]/10 group-hover:shadow-blue-500/30 group-hover:border-[#326CE5]/60 group-hover:-translate-y-2"
                                        : "border-amber-200 bg-amber-50 group-hover:border-amber-400 group-hover:-translate-y-2"
                                )}
                            >
                                {/* Active Glow Layer */}
                                {node.status === 'Ready' && (
                                    <div className="absolute inset-0 bg-gradient-to-br from-[#326CE5]/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-700" />
                                )}

                                {/* Status Orb Corner */}
                                <div className={cn(
                                    "absolute top-3 right-3 h-2.5 w-2.5 rounded-full border-2 border-white",
                                    node.status === 'Ready'
                                        ? "bg-emerald-500 shadow-[0_0_12px_rgba(16,185,129,1)]"
                                        : "bg-amber-500 animate-pulse"
                                )} />

                                {/* Icon Layer */}
                                <Server className={cn(
                                    "transition-all duration-700",
                                    s.icon,
                                    node.status === 'Ready' ? "text-[#326CE5] group-hover:scale-110" : "text-amber-600 opacity-60"
                                )} />

                                {/* DYNAMIC TELEMETRY BARS */}
                                {s.telemetry !== 'hidden' && (
                                    <div className="flex flex-col gap-1 mt-2">
                                        {/* CPU Bar */}
                                        <div className={cn("bg-slate-100 rounded-full overflow-hidden", s.telemetry)}>
                                            <motion.div
                                                initial={{ width: 0 }}
                                                animate={{ width: `${30 + Math.random() * 40}%` }}
                                                transition={{ duration: 2, repeat: Infinity, repeatType: 'reverse' }}
                                                className="h-full bg-blue-500/60"
                                            />
                                        </div>
                                        {/* RAM Bar */}
                                        <div className={cn("bg-slate-100 rounded-full overflow-hidden", s.telemetry)}>
                                            <motion.div
                                                initial={{ width: 0 }}
                                                animate={{ width: `${20 + Math.random() * 30}%` }}
                                                transition={{ duration: 2.5, repeat: Infinity, repeatType: 'reverse' }}
                                                className="h-full bg-indigo-500/50"
                                            />
                                        </div>
                                    </div>
                                )}

                                {/* Subtle ID Label */}
                                {s.label !== 'hidden' && (
                                    <span className={cn("font-black uppercase text-slate-400 mt-1.5 tracking-tighter opacity-70 group-hover:opacity-100 group-hover:text-slate-900 transition-all", s.label)}>
                                        {node.name.split('-').pop()?.toUpperCase()}
                                    </span>
                                )}

                                {/* Hover Scanlines */}
                                <div className="absolute inset-0 bg-[linear-gradient(transparent_0%,rgba(50,108,229,0.05)_50%,transparent_100%)] bg-[length:100%_4px] opacity-0 group-hover:opacity-100 animate-scanline pointer-events-none" />
                            </button>

                            {/* HIGH-FIDELITY HOVER CARD */}
                            <div className="absolute bottom-[calc(100%+1rem)] left-1/2 -translate-x-1/2 mb-4 pointer-events-none opacity-0 group-hover:opacity-100 transition-all duration-500 translate-y-4 group-hover:translate-y-0 z-50">
                                <div className="bg-slate-900/95 backdrop-blur-2xl border border-white/20 p-5 rounded-[1.5rem] shadow-2xl min-w-[240px]">
                                    <div className="flex items-center gap-4 mb-4">
                                        <div className={cn(
                                            "h-12 w-12 rounded-2xl flex items-center justify-center border border-white/10",
                                            node.status === 'Ready' ? "bg-blue-500/20" : "bg-amber-500/20"
                                        )}>
                                            <Server className={cn("h-6 w-6", node.status === 'Ready' ? "text-blue-400" : "text-amber-400")} />
                                        </div>
                                        <div>
                                            <h4 className="text-white font-black text-base leading-tight tracking-tight uppercase truncate max-w-[140px]">
                                                {node.name}
                                            </h4>
                                            <div className="flex items-center gap-2 mt-1">
                                                <div className={cn("h-2 w-2 rounded-full", node.status === 'Ready' ? "bg-emerald-400" : "bg-amber-400")} />
                                                <span className={cn("text-[10px] font-black uppercase tracking-[0.2em]", node.status === 'Ready' ? "text-emerald-400" : "text-amber-400")}>
                                                    {node.status}
                                                </span>
                                            </div>
                                        </div>
                                    </div>

                                    <div className="space-y-3 pt-4 border-t border-white/10">
                                        <div className="flex justify-between items-center">
                                            <div className="flex items-center gap-2">
                                                <Cpu className="h-3 w-3 text-blue-400" />
                                                <span className="text-[9px] font-bold text-slate-500 uppercase tracking-widest">Compute Load</span>
                                            </div>
                                            <span className="text-xs font-black text-white tabular-nums">34%</span>
                                        </div>
                                        <div className="flex justify-between items-center">
                                            <div className="flex items-center gap-2">
                                                <HardDrive className="h-3 w-3 text-indigo-400" />
                                                <span className="text-[9px] font-bold text-slate-500 uppercase tracking-widest">Memory Reserved</span>
                                            </div>
                                            <span className="text-xs font-black text-white tabular-nums">12.4 GB</span>
                                        </div>
                                        <div className="flex justify-between items-center">
                                            <div className="flex items-center gap-2">
                                                <Activity className="h-3 w-3 text-emerald-400" />
                                                <span className="text-[9px] font-bold text-slate-500 uppercase tracking-widest">Latency</span>
                                            </div>
                                            <span className="text-xs font-black text-white tabular-nums">0.8ms</span>
                                        </div>
                                    </div>

                                    {/* Action Footnote */}
                                    <div className="mt-4 pt-3 border-t border-white/5 text-center">
                                        <span className="text-[8px] font-black text-blue-400 uppercase tracking-[0.3em] animate-pulse">Click to inspect unit</span>
                                    </div>

                                    {/* Arrow */}
                                    <div className="absolute top-full left-1/2 -translate-x-1/2 -mt-1 border-8 border-transparent border-t-slate-900/95" />
                                </div>

                                {/* External holographic glow */}
                                <div className="absolute inset-x-0 -bottom-4 h-24 bg-blue-500/30 blur-[40px] -z-10 rounded-full opacity-40" />
                            </div>
                        </motion.div>
                    ))}
                </AnimatePresence>

                {nodes.length === 0 && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        className="h-40 w-full flex flex-col items-center justify-center border-2 border-dashed border-[#326CE5]/10 rounded-3xl bg-white/40"
                    >
                        <Activity className="h-8 w-8 text-[#326CE5] opacity-20 mb-3 animate-pulse" />
                        <span className="text-[11px] font-black text-[#326CE5]/40 uppercase tracking-[0.4em]">Discovery Stream Initializing...</span>
                    </motion.div>
                )}
            </div>
        </div>
    );
}
