import React from 'react';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';

interface ComplianceMedalProps {
    grade: string;
    score: number;
    className?: string;
}

export function ComplianceMedal({ grade, score, className }: ComplianceMedalProps) {
    const getGradeStyles = (g: string) => {
        const grade = g?.toUpperCase() || 'F';
        switch (grade) {
            case 'A': return 'from-[#326CE5] to-blue-400 text-white shadow-[#326CE5]/20';
            case 'B': return 'from-blue-500 to-blue-300 text-white shadow-blue-500/20';
            case 'C': return 'from-blue-600 to-blue-400 text-white shadow-blue-600/20';
            default: return 'from-slate-400 to-slate-200 text-slate-700 shadow-slate-400/20';
        }
    };

    return (
        <div className={cn("flex flex-col items-center justify-center gap-4", className)}>
            <div className="relative group">
                {/* Outer Glow Ring */}
                <div className="absolute inset-0 rounded-full bg-[#326CE5]/10 animate-pulse blur-xl transition-all group-hover:bg-[#326CE5]/20" />

                {/* The Medal */}
                <motion.div
                    initial={{ scale: 0.8, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ type: 'spring', damping: 15 }}
                    className={cn(
                        "relative w-32 h-32 rounded-full flex flex-col items-center justify-center border-4 border-white shadow-2xl bg-gradient-to-br",
                        getGradeStyles(grade)
                    )}
                >
                    <span className="text-5xl font-black tracking-tighter drop-shadow-md">
                        {grade || 'F'}
                    </span>
                    <span className="text-[10px] font-bold uppercase tracking-[0.2em] opacity-80">
                        Grade
                    </span>
                </motion.div>

                {/* Satellite Score Badge */}
                <motion.div
                    initial={{ x: 20, opacity: 0 }}
                    animate={{ x: 0, opacity: 1 }}
                    transition={{ delay: 0.3 }}
                    className="absolute -bottom-2 -right-2 bg-white text-[#326CE5] px-3 py-1 rounded-full border border-blue-100 shadow-lg text-sm font-black"
                >
                    {score}%
                </motion.div>
            </div>

            <div className="text-center">
                <p className="text-[#326CE5] font-bold text-sm">Compliance Standing</p>
                <p className="text-xs text-muted-foreground font-medium">CIS Benchmark v1.23</p>
            </div>
        </div>
    );
}
