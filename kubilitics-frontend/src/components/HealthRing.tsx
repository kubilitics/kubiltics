import { motion } from 'framer-motion';

interface HealthRingProps {
    score: number;
    size?: number;
    strokeWidth?: number;
    showText?: boolean;
}

export function HealthRing({
    score,
    size = 64,
    strokeWidth = 6,
    showText = true,
}: HealthRingProps) {
    const radius = (size - strokeWidth) / 2;
    const circumference = radius * 2 * Math.PI;
    const offset = circumference - (score / 100) * circumference;

    const getColor = (s: number) => {
        if (s >= 80) return '#10b981'; // emerald-500
        if (s >= 50) return '#f59e0b'; // amber-500
        return '#ef4444'; // red-500
    };

    const getBgColor = (s: number) => {
        if (s >= 80) return 'rgba(16, 185, 129, 0.1)';
        if (s >= 50) return 'rgba(245, 158, 11, 0.1)';
        return 'rgba(239, 68, 68, 0.1)';
    };

    const color = getColor(score);
    const bgColor = getBgColor(score);

    return (
        <div className="relative flex items-center justify-center" style={{ width: size, height: size }}>
            <svg width={size} height={size} className="transform -rotate-90">
                <circle
                    cx={size / 2}
                    cy={size / 2}
                    r={radius}
                    stroke="rgba(0, 0, 0, 0.04)"
                    strokeWidth={strokeWidth}
                    fill="none"
                />
                {/* Progress circle */}
                <motion.circle
                    cx={size / 2}
                    cy={size / 2}
                    r={radius}
                    stroke={color}
                    strokeWidth={strokeWidth}
                    strokeDasharray={circumference}
                    initial={{ strokeDashoffset: circumference }}
                    animate={{ strokeDashoffset: offset }}
                    transition={{ duration: 1.5, ease: "easeOut" }}
                    strokeLinecap="round"
                    fill="none"
                />
            </svg>
            {showText && (
                <div className="absolute inset-0 flex items-center justify-center flex-col leading-none">
                    <span
                        className="font-bold tracking-tight tabular-nums text-slate-900"
                        style={{ fontSize: `${Math.max(12, size * 0.28)}px` }}
                    >
                        {score}
                    </span>
                    <span
                        className="uppercase tracking-[0.1em] text-slate-400 font-bold"
                        style={{ fontSize: `${Math.max(7, size * 0.08)}px`, marginTop: `${size * 0.05}px` }}
                    >
                        Score
                    </span>
                </div>
            )}
        </div>
    );
}
