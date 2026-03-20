import React, { useMemo } from 'react';
import { AreaChart, Area, ResponsiveContainer, YAxis } from 'recharts';

export function NetworkingPulse() {
    // Generate synthetic pulse data that looks organic
    const data = useMemo(() => {
        return Array.from({ length: 20 }, (_, i) => ({
            time: i,
            value: 40 + Math.random() * 40 + (Math.sin(i / 2) * 20),
        }));
    }, []);

    return (
        <div className="h-[120px] w-full mt-4">
            <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={data}>
                    <defs>
                        <linearGradient id="pulseGradient" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#326CE5" stopOpacity={0.3} />
                            <stop offset="95%" stopColor="#326CE5" stopOpacity={0} />
                        </linearGradient>
                    </defs>
                    <YAxis hide domain={[0, 120]} />
                    <Area
                        type="monotone"
                        dataKey="value"
                        stroke="#326CE5"
                        strokeWidth={2}
                        fillOpacity={1}
                        fill="url(#pulseGradient)"
                        animationDuration={2000}
                        isAnimationActive={true}
                    />
                </AreaChart>
            </ResponsiveContainer>
        </div>
    );
}
