import React from 'react';
import { PieChart, Pie, Cell, ResponsiveContainer } from 'recharts';

interface QuotaPulseProps {
    title: string;
    percent: number;
    color?: string;
}

export function QuotaPulse({ title, percent, color = "#326CE5" }: QuotaPulseProps) {
    const data = [
        { value: percent },
        { value: 100 - percent },
    ];

    return (
        <div className="flex flex-col items-center justify-center p-4">
            <ResponsiveContainer width="100%" height={120}>
                <PieChart>
                    <Pie
                        data={data}
                        cx="50%"
                        cy="50%"
                        innerRadius={35}
                        outerRadius={45}
                        startAngle={90}
                        endAngle={-270}
                        dataKey="value"
                        stroke="none"
                        cornerRadius={10}
                    >
                        <Cell key="cell-0" fill={color} />
                        <Cell key="cell-1" fill={color} fillOpacity={0.05} />
                    </Pie>
                </PieChart>
            </ResponsiveContainer>
            <div className="mt-2 text-center">
                <span className="block text-lg font-black text-[#326CE5]">{percent}%</span>
                <span className="text-[10px] font-black text-muted-foreground uppercase tracking-widest">{title}</span>
            </div>
        </div>
    );
}
