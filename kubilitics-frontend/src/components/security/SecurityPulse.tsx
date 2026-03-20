import React, { useMemo } from 'react';
import {
    PieChart,
    Pie,
    Cell,
    ResponsiveContainer,
} from 'recharts';
import { motion, AnimatePresence } from 'framer-motion';
import { Shield, ShieldAlert, ShieldCheck } from 'lucide-react';

interface SecurityPulseProps {
    score?: number;
    summary?: {
        critical: number;
        high: number;
        medium: number;
        low: number;
    };
}

/**
 * SecurityPulse - A premium intelligence gauge for cluster security posture.
 * Follows the high-fidelity aesthetic of Workload Pulse with security-specific themed elements.
 */
export function SecurityPulse({ score = 0, summary }: SecurityPulseProps) {
    const critical = summary?.critical ?? 0;
    const high = summary?.high ?? 0;
    const medium = summary?.medium ?? 0;
    const low = summary?.low ?? 0;
    const totalIssues = critical + high + medium + low;

    const chartData = useMemo(() => {
        const items = [];
        // We use a fixed-width segment logic or proportional? 
        // For security, showing the "risk segments" clearly is better.
        // If no issues, show a solid emerald ring.
        if (totalIssues === 0) {
            items.push({ name: 'Secure', value: 100, color: '#10B981' });
        } else {
            if (critical > 0) items.push({ name: 'Critical', value: critical, color: '#EF4444' }); // Rose 500
            if (high > 0) items.push({ name: 'High', value: high, color: '#F59E0B' }); // Amber 500
            if (medium > 0) items.push({ name: 'Medium', value: medium, color: '#3b82f6' }); // Blue 500
            if (low > 0) items.push({ name: 'Low', value: low, color: '#94a3b8' }); // Slate 400
        }
        return items;
    }, [critical, high, medium, low, totalIssues]);

    const getStatusColor = () => {
        if (score >= 90) return 'text-emerald-500';
        if (score >= 70) return 'text-blue-500';
        if (score >= 50) return 'text-amber-500';
        return 'text-rose-500';
    };

    const StatusIcon = score >= 90 ? ShieldCheck : score >= 70 ? Shield : ShieldAlert;

    return (
        <div className="relative h-[320px] w-full flex items-center justify-center">
            {/* Background Atmosphere Glow */}
            <div className="absolute inset-0 flex items-center justify-center overflow-hidden pointer-events-none">
                <motion.div
                    animate={{
                        opacity: [0.03, 0.08, 0.03],
                        scale: [0.8, 1.2, 0.8]
                    }}
                    transition={{ duration: 8, repeat: Infinity, ease: "easeInOut" }}
                    className={`w-[260px] h-[260px] rounded-full blur-[80px] ${score >= 70 ? 'bg-blue-500' : 'bg-rose-500'}`}
                />
            </div>

            <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                    <Pie
                        data={chartData}
                        cx="50%"
                        cy="50%"
                        innerRadius={90}
                        outerRadius={115}
                        paddingAngle={totalIssues > 0 ? 6 : 0}
                        dataKey="value"
                        stroke="none"
                        isAnimationActive={true}
                        animationDuration={1500}
                        startAngle={90}
                        endAngle={-270}
                    >
                        {chartData.map((entry, index) => (
                            <Cell
                                key={`cell-${index}`}
                                fill={entry.color}
                                className="drop-shadow-[0_0_12px_rgba(0,0,0,0.1)]"
                            />
                        ))}
                    </Pie>
                </PieChart>
            </ResponsiveContainer>

            {/* Central Score Node */}
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 flex flex-col items-center justify-center w-[160px] h-[160px] rounded-full bg-white shadow-2xl border border-slate-50 z-20">
                <motion.div
                    animate={{ scale: [1, 1.03, 1], opacity: [0.4, 0.2, 0.4] }}
                    transition={{ duration: 4, repeat: Infinity }}
                    className="absolute inset-3 border border-slate-100 rounded-full"
                />

                <span className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mb-1 z-10">Posture Score</span>

                <AnimatePresence mode="wait">
                    <motion.div
                        key={score}
                        initial={{ opacity: 0, scale: 0.9 }}
                        animate={{ opacity: 1, scale: 1 }}
                        className="flex items-baseline z-10"
                    >
                        <span className="text-5xl font-black text-slate-900 tracking-tighter">
                            {score}
                        </span>
                        <span className={`text-xl font-black ml-1 ${getStatusColor()}`}>/100</span>
                    </motion.div>
                </AnimatePresence>

                <div className="flex items-center gap-2 mt-3 z-10 px-4 py-1.5 rounded-full bg-slate-50 border border-slate-100">
                    <StatusIcon className={`h-3.5 w-3.5 ${getStatusColor()}`} />
                    <span className="text-[10px] font-bold text-slate-600 uppercase tracking-tight">
                        {score >= 90 ? 'Hardened' : score >= 70 ? 'Resilient' : score >= 50 ? 'Warning' : 'Critical'}
                    </span>
                </div>
            </div>

            {/* Decorative Labels */}
            <div className="absolute inset-0 pointer-events-none flex flex-col justify-between p-6">
                <div className="flex justify-between items-start">
                    <div className="flex flex-col">
                        <span className="text-[10px] font-black text-slate-400 mb-1 uppercase tracking-widest">Active Guard</span>
                        <div className="h-0.5 w-8 bg-blue-500/20 rounded-full" />
                    </div>
                    <div className="flex flex-col items-end">
                        <span className="text-[10px] font-black text-slate-400 mb-1 uppercase tracking-widest">Live Audit</span>
                        <div className="h-0.5 w-8 bg-emerald-500/20 rounded-full" />
                    </div>
                </div>
                <div className="flex justify-center pb-2">
                    <span className="text-[10px] font-black text-slate-300 uppercase tracking-[0.3em]">Kubilitics Intelligence Unit</span>
                </div>
            </div>
        </div>
    );
}
