import React from 'react';
import { motion } from 'framer-motion';
import { ShieldCheck, ShieldAlert, ShieldX, Trophy } from 'lucide-react';
import { cn } from '@/lib/utils';

interface HolographicMedalProps {
    grade: string;
    score: number;
    size?: 'sm' | 'md' | 'lg';
    className?: string;
}

export const HolographicMedal: React.FC<HolographicMedalProps> = ({
    grade,
    score,
    size = 'md',
    className
}) => {
    const getGradeColors = () => {
        const g = grade?.toUpperCase() || 'F';
        switch (g) {
            case 'A': return { from: 'from-emerald-400', to: 'to-teal-600', shadow: 'shadow-emerald-500/20', icon: ShieldCheck };
            case 'B': return { from: 'from-blue-400', to: 'to-indigo-600', shadow: 'shadow-blue-500/20', icon: ShieldCheck };
            case 'C': return { from: 'from-amber-400', to: 'to-orange-600', shadow: 'shadow-amber-500/20', icon: ShieldAlert };
            case 'D': return { from: 'from-orange-400', to: 'to-red-600', shadow: 'shadow-orange-500/20', icon: ShieldAlert };
            default: return { from: 'from-red-500', to: 'to-rose-800', shadow: 'shadow-red-500/20', icon: ShieldX };
        }
    };

    const colors = getGradeColors();
    const Icon = colors.icon;

    const sizeMap = {
        sm: {
            container: 'w-24 h-24',
            gradeText: 'text-4xl',
            iconSize: 'w-4 h-4',
            iconOffset: '-top-1 -right-1',
            scorePill: 'mt-0.5 px-2 py-0.5',
            scoreText: 'text-[8px]',
            trophySize: 'w-2 h-2',
            statusLabel: 'bottom-2 text-[6px]',
            blur: 'blur-[20px]'
        },
        md: {
            container: 'w-36 h-36',
            gradeText: 'text-6xl',
            iconSize: 'w-6 h-6',
            iconOffset: '-top-2 -right-2',
            scorePill: 'mt-1 px-4 py-1',
            scoreText: 'text-[9px]',
            trophySize: 'w-2.5 h-2.5',
            statusLabel: 'bottom-3 text-[8px]',
            blur: 'blur-[30px]'
        },
        lg: {
            container: 'w-48 h-48',
            gradeText: 'text-8xl',
            iconSize: 'w-8 h-8',
            iconOffset: '-top-4 -right-4',
            scorePill: 'mt-2 px-6 py-1.5',
            scoreText: 'text-xs',
            trophySize: 'w-3 h-3',
            statusLabel: 'bottom-4 text-[10px]',
            blur: 'blur-[40px]'
        }
    };

    const s = sizeMap[size];

    return (
        <div className={cn("relative group cursor-default inline-block", className)}>
            {/* Animated Glow Backdrop */}
            <motion.div
                animate={{
                    scale: [1, 1.1, 1],
                    opacity: [0.2, 0.4, 0.2]
                }}
                transition={{ duration: 4, repeat: Infinity }}
                className={cn("absolute inset-0 rounded-full bg-gradient-to-br opacity-20", colors.from, colors.to, s.blur)}
            />

            <div className={cn(
                "relative z-10 rounded-full bg-slate-900 border border-white/10 flex flex-col items-center justify-center overflow-hidden transition-transform duration-500 group-hover:scale-105 shadow-2xl",
                s.container,
                colors.shadow
            )}>
                {/* Iridescent Overlay */}
                <div className="absolute inset-0 bg-gradient-to-tr from-white/10 via-transparent to-white/5 pointer-events-none" />

                {/* Animated Background Pulse */}
                <motion.div
                    animate={{ rotate: 360 }}
                    transition={{ duration: 25, repeat: Infinity, ease: "linear" }}
                    className="absolute inset-0 opacity-10"
                >
                    <svg className="w-full h-full" viewBox="0 0 100 100">
                        <circle cx="50" cy="50" r="48" fill="none" stroke="currentColor" strokeWidth="0.25" strokeDasharray="1 3" />
                        <circle cx="50" cy="50" r="40" fill="none" stroke="currentColor" strokeWidth="0.25" strokeDasharray="2 4" />
                    </svg>
                </motion.div>

                {/* Grade Letter */}
                <motion.div
                    initial={{ scale: 0.5, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    className="relative flex flex-col items-center"
                >
                    <span className={cn(
                        "font-black bg-clip-text text-transparent bg-gradient-to-br tracking-tighter drop-shadow-[0_0_15px_rgba(255,255,255,0.15)]",
                        s.gradeText,
                        colors.from,
                        colors.to
                    )}>
                        {grade}
                    </span>
                    <div className={cn("absolute", s.iconOffset)}>
                        <Icon className={cn(s.iconSize, (grade === 'A' || grade === 'B') ? 'text-emerald-400' : 'text-rose-400')} />
                    </div>
                </motion.div>

                {/* Score Pill */}
                <div className={cn("rounded-full bg-white/5 border border-white/10 backdrop-blur-md shadow-inner", s.scorePill)}>
                    <div className="flex items-center gap-1">
                        <Trophy className={cn("text-amber-400", s.trophySize)} />
                        <span className={cn("font-black tracking-widest text-slate-100 uppercase italic leading-none", s.scoreText)}>
                            {score}
                        </span>
                    </div>
                </div>

                {/* Bottom Status Label */}
                {size !== 'sm' && (
                    <div className={cn("absolute left-0 right-0 text-center", s.statusLabel)}>
                        <span className="font-black uppercase tracking-[0.2em] text-slate-500/80">
                            Status
                        </span>
                    </div>
                )}
            </div>
        </div>
    );
};
