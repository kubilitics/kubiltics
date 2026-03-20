import React from 'react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';

interface ServiceDistributionProps {
    data: {
        services: number;
        ingresses: number;
        policies: number;
    };
}

export function ServiceDistribution({ data }: ServiceDistributionProps) {
    const chartData = [
        { name: 'Services', value: data.services },
        { name: 'Ingresses', value: data.ingresses },
        { name: 'Policies', value: data.policies },
    ];

    const COLORS = ['#326CE5', '#60A5FA', '#93C5FD'];

    return (
        <div className="h-[200px] w-full">
            <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                    <Pie
                        data={chartData}
                        cx="50%"
                        cy="50%"
                        innerRadius={60}
                        outerRadius={80}
                        paddingAngle={5}
                        dataKey="value"
                        stroke="none"
                    >
                        {chartData.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                        ))}
                    </Pie>
                    <Tooltip
                        contentStyle={{
                            backgroundColor: '#FFFFFF',
                            borderRadius: '12px',
                            border: '1px solid #E2E8F0',
                            boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)'
                        }}
                    />
                </PieChart>
            </ResponsiveContainer>
        </div>
    );
}
