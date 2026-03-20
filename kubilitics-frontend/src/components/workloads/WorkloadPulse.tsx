import React, { useMemo } from 'react';
import {
    PieChart,
    Pie,
    Cell,
    ResponsiveContainer,
} from 'recharts';
import { motion, AnimatePresence } from 'framer-motion';

interface WorkloadPulseProps {
    data?: {
        healthy: number;
        warning: number;
        critical: number;
        total: number;
        optimal_percent: number;
    };
}

/**
 * WorkloadPulse - A high-clarity "Intelligence Hub" visualization.
 * Uses a segmented donut (PieChart) to ensure zero radial overlap and maximum at-a-glance insight.
 */
export function WorkloadPulse({ data }: WorkloadPulseProps) {
    const h = data?.healthy ?? 0;
    const w = data?.warning ?? 0;
    const c = data?.critical ?? 0;
    const total = data?.total ?? (h + w + c);
    const score = data?.optimal_percent ?? (total > 0 ? (h / total) * 100 : 0);

    // Filter out zero values to prevent rendering artifacts
    const chartData = useMemo(() => {
        const items = [];
        if (h > 0) items.push({ name: 'Healthy', value: h, color: '#10B981' }); // Emerald 500
        if (w > 0) items.push({ name: 'Warning', value: w, color: '#F59E0B' }); // Amber 500
        if (c > 0) items.push({ name: 'Critical', value: c, color: '#EF4444' }); // Rose 500

        // If all zero, show a neutral ring
        if (items.length === 0) {
            items.push({ name: 'Neutral', value: 1, color: '#F1F5F9' });
        }
        return items;
    }, [h, w, c]);

    return (
        <div className="relative h-[280px] w-full flex items-center justify-center p-4">
            {/* Soft Ambient Glow Overlay */}
            <div className="absolute inset-0 flex items-center justify-center overflow-hidden pointer-events-none">
                <motion.div
                    animate={{
                        opacity: [0.02, 0.05, 0.02],
                        scale: [0.9, 1.1, 0.9]
                    }}
                    transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}
                    className="w-[240px] h-[240px] bg-blue-500 rounded-full blur-[60px]"
                />
            </div>

            <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                    <Pie
                        data={chartData}
                        cx="50%"
                        cy="50%"
                        innerRadius={80}
                        outerRadius={105}
                        paddingAngle={4}
                        dataKey="value"
                        stroke="none"
                        isAnimationActive={true}
                        animationDuration={1200}
                    >
                        {chartData.map((entry, index) => (
                            <Cell
                                key={`cell-${index}`}
                                fill={entry.color}
                                className="drop-shadow-[0_0_8px_rgba(0,0,0,0.05)]"
                            />
                        ))}
                    </Pie>
                </PieChart>
            </ResponsiveContainer>

            {/* Central Intelligence Score - Sized to fit within innerRadius */}
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 flex flex-col items-center justify-center w-[140px] h-[140px] rounded-full bg-white shadow-xl shadow-blue-500/5 border border-slate-50 z-20 overflow-hidden">
                {/* Visual pulse ring */}
                <motion.div
                    animate={{ scale: [1, 1.05, 1], opacity: [0.3, 0.1, 0.3] }}
                    transition={{ duration: 3, repeat: Infinity }}
                    className="absolute inset-2 border-2 border-blue-100 rounded-full"
                />

                <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mb-1 z-10">Cluster Health</span>
                <AnimatePresence mode="wait">
                    <motion.div
                        key={score}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="flex items-baseline z-10"
                    >
                        <span className="text-4xl font-bold text-slate-900 tracking-tighter">
                            {score.toFixed(0)}
                        </span>
                        <span className="text-lg font-bold text-blue-500 ml-0.5">%</span>
                    </motion.div>
                </AnimatePresence>

                <div className="flex items-center gap-1.5 mt-2 z-10">
                    <div className={`h-1.5 w-1.5 rounded-full ${score > 90 ? 'bg-emerald-500' : 'bg-amber-500'} animate-pulse`} />
                    <span className="text-[10px] font-bold text-slate-500 uppercase tracking-tight">Sync Active</span>
                </div>
            </div>

            {/* Clean Segment Labels - Positioned at corners to avoid overlap */}
            <div className="absolute inset-0 pointer-events-none text-[9px] font-bold text-slate-400 uppercase tracking-widest flex flex-col justify-between p-2">
                <div className="flex justify-between items-start">
                    <span className="bg-white/80 backdrop-blur-sm px-2 py-1 rounded-md border border-slate-100/50">Liveness Pulse</span>
                    <span className="bg-white/80 backdrop-blur-sm px-2 py-1 rounded-md border border-slate-100/50">Controller State</span>
                </div>
                <div className="flex justify-center">
                    <span className="bg-slate-900/5 backdrop-blur-sm px-3 py-1 rounded-full text-blue-600 border border-blue-100/30">Autonomous Intelligence</span>
                </div>
            </div>
        </div>
    );
}
