import React, { useMemo } from 'react';
import { AreaChart, Area, ResponsiveContainer } from 'recharts';

export function StoragePerformanceSparkline() {
    const data = useMemo(() => {
        return Array.from({ length: 15 }, (_, i) => ({
            time: i,
            iops: 50 + Math.random() * 30 + (Math.sin(i) * 10),
        }));
    }, []);

    return (
        <div className="h-[60px] w-full">
            <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={data}>
                    <Area
                        type="monotone"
                        dataKey="iops"
                        stroke="#326CE5"
                        strokeWidth={2}
                        fill="#326CE5"
                        fillOpacity={0.05}
                    />
                </AreaChart>
            </ResponsiveContainer>
        </div>
    );
}
