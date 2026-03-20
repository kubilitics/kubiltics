import React from 'react';
import { PieChart, Pie, Cell, ResponsiveContainer, Text } from 'recharts';

interface StorageRadialProps {
    title: string;
    value: number; // percentage
    subtext: string;
}

export function StorageRadial({ title, value, subtext }: StorageRadialProps) {
    const data = [
        { name: 'Used', value: value },
        { name: 'Available', value: 100 - value },
    ];

    return (
        <div className="flex flex-col items-center justify-center h-full w-full">
            <ResponsiveContainer width="100%" height={160}>
                <PieChart>
                    <Pie
                        data={data}
                        cx="50%"
                        cy="50%"
                        innerRadius={50}
                        outerRadius={70}
                        startAngle={180}
                        endAngle={-180}
                        dataKey="value"
                        stroke="none"
                    >
                        <Cell key="cell-0" fill="#326CE5" />
                        <Cell key="cell-1" fill="#326CE5" fillOpacity={0.1} />
                    </Pie>
                    <Text
                        x="50%"
                        y="45%"
                        textAnchor="middle"
                        dominantBaseline="middle"
                        className="text-2xl font-black fill-[#326CE5]"
                    >
                        {`${Math.round(value)}%`}
                    </Text>
                    <Text
                        x="50%"
                        y="60%"
                        textAnchor="middle"
                        dominantBaseline="middle"
                        className="text-[10px] font-bold fill-muted-foreground uppercase tracking-widest"
                    >
                        {subtext}
                    </Text>
                </PieChart>
            </ResponsiveContainer>
            <span className="text-xs font-black text-[#326CE5] uppercase tracking-tighter mt-2">{title}</span>
        </div>
    );
}
