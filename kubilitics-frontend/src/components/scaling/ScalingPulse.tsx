import React, { useMemo } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, ResponsiveContainer, Cell } from 'recharts';

export function ScalingPulse() {
    const data = useMemo(() => [
        { name: 'App-V1', desired: 10, current: 10 },
        { name: 'App-V2', desired: 15, current: 14 },
        { name: 'Cache', desired: 3, current: 3 },
        { name: 'Worker', desired: 20, current: 20 },
        { name: 'Proxy', desired: 5, current: 4 },
        { name: 'Auth', desired: 2, current: 2 },
    ], []);

    return (
        <div className="h-[200px] w-full mt-4">
            <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" />
                    <XAxis
                        dataKey="name"
                        axisLine={false}
                        tickLine={false}
                        tick={{ fill: '#64748B', fontSize: 10, fontWeight: 700 }}
                    />
                    <YAxis
                        axisLine={false}
                        tickLine={false}
                        tick={{ fill: '#64748B', fontSize: 10, fontWeight: 700 }}
                    />
                    <Bar dataKey="current" radius={[4, 4, 0, 0]}>
                        {data.map((entry, index) => (
                            <Cell
                                key={`cell-${index}`}
                                fill={entry.current < entry.desired ? "#326CE5" : "#326CE5"}
                                fillOpacity={entry.current < entry.desired ? 0.4 : 1}
                            />
                        ))}
                    </Bar>
                </BarChart>
            </ResponsiveContainer>
        </div>
    );
}
