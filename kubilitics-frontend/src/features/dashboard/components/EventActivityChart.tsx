import React from 'react';
import { BarChart, Bar, ResponsiveContainer, XAxis, Tooltip, Cell } from 'recharts';

const data = [
    { time: '10:00', events: 12, type: 'normal' },
    { time: '10:05', events: 8, type: 'normal' },
    { time: '10:10', events: 15, type: 'warning' },
    { time: '10:15', events: 22, type: 'critical' },
    { time: '10:20', events: 10, type: 'normal' },
    { time: '10:25', events: 5, type: 'normal' },
    { time: '10:30', events: 18, type: 'warning' },
    { time: '10:35', events: 25, type: 'critical' },
    { time: '10:40', events: 12, type: 'normal' },
    { time: '10:45', events: 8, type: 'normal' },
    { time: '10:50', events: 15, type: 'warning' },
    { time: '10:55', events: 4, type: 'normal' },
];

export const EventActivityChart = () => {

    const getColor = (entry: Record<string, unknown>) => {
        if (entry.events > 20) return '#f43f5e'; // Rose 500 (Critical)
        if (entry.events > 12) return '#f59e0b'; // Amber 500 (Warning)
        return '#3b82f6'; // Blue 500 (Normal)
    };

    return (
        <div className="h-full w-full">
            <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data} barSize={6}>
                    <Tooltip
                        cursor={{ fill: 'transparent' }}
                        content={({ active, payload }) => {
                            if (active && payload && payload.length) {
                                return (
                                    <div className="rounded-lg border border-border bg-popover px-3 py-2 shadow-sm">
                                        <div className="flex flex-col gap-1">
                                            <span className="text-[10px] uppercase text-muted-foreground font-semibold">
                                                {payload[0].payload.time}
                                            </span>
                                            <span className="font-bold text-foreground">
                                                {payload[0].value} Events
                                            </span>
                                        </div>
                                    </div>
                                );
                            }
                            return null;
                        }}
                    />
                    <Bar dataKey="events" radius={[2, 2, 0, 0]}>
                        {data.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={getColor(entry)} />
                        ))}
                    </Bar>
                </BarChart>
            </ResponsiveContainer>
        </div>
    );
};
