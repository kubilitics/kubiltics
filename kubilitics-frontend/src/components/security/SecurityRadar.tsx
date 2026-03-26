import React from 'react';
import {
    Radar,
    RadarChart,
    PolarGrid,
    PolarAngleAxis,
    ResponsiveContainer,
    PolarRadiusAxis
} from 'recharts';
import { K8S_BLUE } from '@/lib/colors';

interface SecurityRadarProps {
    data: {
        critical: number;
        high: number;
        medium: number;
        low: number;
    };
}

export function SecurityRadar({ data }: SecurityRadarProps) {
    const chartData = [
        { subject: 'Critical', value: data?.critical ?? 0, fullMark: 100 },
        { subject: 'High', value: data?.high ?? 0, fullMark: 100 },
        { subject: 'Medium', value: data?.medium ?? 0, fullMark: 100 },
        { subject: 'Low', value: data?.low ?? 0, fullMark: 100 },
    ];

    return (
        <div className="h-[300px] w-full flex items-center justify-center">
            <ResponsiveContainer width="100%" height="100%">
                <RadarChart cx="50%" cy="50%" outerRadius="80%" data={chartData}>
                    <PolarGrid stroke={K8S_BLUE} strokeOpacity={0.15} />
                    <PolarAngleAxis
                        dataKey="subject"
                        tick={{ fill: K8S_BLUE, fontSize: 12, fontWeight: 600 }}
                    />
                    <PolarRadiusAxis
                        angle={30}
                        domain={[0, 'auto']}
                        tick={false}
                        axisLine={false}
                    />
                    <Radar
                        name="Vulnerabilities"
                        dataKey="value"
                        stroke={K8S_BLUE}
                        strokeWidth={2}
                        fill={K8S_BLUE}
                        fillOpacity={0.3}
                    />
                </RadarChart>
            </ResponsiveContainer>
        </div>
    );
}
