import { useMemo } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, Area, AreaChart } from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Activity, TrendingUp, TrendingDown, Minus } from 'lucide-react';

interface MetricDataPoint {
  timestamp: string;
  value: number;
}

interface ResourceMetricsChartProps {
  title: string;
  data: MetricDataPoint[];
  dataKey?: string;
  color?: string;
  unit?: string;
  showTrend?: boolean;
  limit?: number;
  chartType?: 'line' | 'area';
}

export function ResourceMetricsChart({
  title,
  data,
  dataKey = 'value',
  color = '#3b82f6',
  unit = '%',
  showTrend = true,
  limit,
  chartType = 'area'
}: ResourceMetricsChartProps) {
  // Transform data for chart
  const chartData = useMemo(() => {
    return data.map(point => ({
      time: new Date(point.timestamp).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit'
      }),
      [dataKey]: point.value,
      ...(limit && { limit })
    }));
  }, [data, dataKey, limit]);

  // Calculate trend
  const trend = useMemo(() => {
    if (!showTrend || data.length < 2) return null;

    const firstValue = data[0].value;
    const lastValue = data[data.length - 1].value;
    const change = ((lastValue - firstValue) / firstValue) * 100;

    return {
      direction: change > 5 ? 'up' : change < -5 ? 'down' : 'stable',
      percentage: Math.abs(change).toFixed(1)
    };
  }, [data, showTrend]);

  // Calculate statistics
  const stats = useMemo(() => {
    if (data.length === 0) return null;

    const values = data.map(d => d.value);
    const current = values[values.length - 1];
    const avg = values.reduce((sum, v) => sum + v, 0) / values.length;
    const max = Math.max(...values);
    const min = Math.min(...values);

    return {
      current: current.toFixed(1),
      avg: avg.toFixed(1),
      max: max.toFixed(1),
      min: min.toFixed(1)
    };
  }, [data]);

  const getTrendIcon = () => {
    if (!trend) return null;

    switch (trend.direction) {
      case 'up':
        return <TrendingUp className="h-4 w-4 text-orange-600" />;
      case 'down':
        return <TrendingDown className="h-4 w-4 text-green-600" />;
      case 'stable':
        return <Minus className="h-4 w-4 text-blue-600" />;
    }
  };

  const getTrendColor = () => {
    if (!trend) return '';

    switch (trend.direction) {
      case 'up':
        return 'text-orange-600';
      case 'down':
        return 'text-green-600';
      case 'stable':
        return 'text-blue-600';
    }
  };

  if (!data || data.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">{title}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-64 flex items-center justify-center text-muted-foreground text-sm">
            No data available
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Activity className="h-4 w-4" />
            {title}
          </CardTitle>
          {trend && (
            <div className={`flex items-center gap-1 text-xs font-medium ${getTrendColor()}`}>
              {getTrendIcon()}
              <span>{trend.percentage}%</span>
            </div>
          )}
        </div>

        {/* Stats */}
        {stats && (
          <div className="grid grid-cols-4 gap-2 mt-2">
            <div className="text-center">
              <p className="text-xs text-muted-foreground">Current</p>
              <p className="text-sm font-semibold">{stats.current}{unit}</p>
            </div>
            <div className="text-center">
              <p className="text-xs text-muted-foreground">Avg</p>
              <p className="text-sm font-semibold">{stats.avg}{unit}</p>
            </div>
            <div className="text-center">
              <p className="text-xs text-muted-foreground">Max</p>
              <p className="text-sm font-semibold">{stats.max}{unit}</p>
            </div>
            <div className="text-center">
              <p className="text-xs text-muted-foreground">Min</p>
              <p className="text-sm font-semibold">{stats.min}{unit}</p>
            </div>
          </div>
        )}
      </CardHeader>

      <CardContent>
        <ResponsiveContainer width="100%" height={200}>
          {chartType === 'area' ? (
            <AreaChart data={chartData}>
              <defs>
                <linearGradient id={`gradient-${dataKey}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={color} stopOpacity={0.3} />
                  <stop offset="95%" stopColor={color} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis
                dataKey="time"
                stroke="#6b7280"
                fontSize={11}
                tickLine={false}
              />
              <YAxis
                stroke="#6b7280"
                fontSize={11}
                tickLine={false}
                domain={[0, limit ? limit * 1.1 : 'auto']}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: 'white',
                  border: '1px solid #e5e7eb',
                  borderRadius: '6px',
                  fontSize: '12px'
                }}
                formatter={(value: number | string) => [`${value}${unit}`, title]}
              />
              <Area
                type="monotone"
                dataKey={dataKey}
                stroke={color}
                strokeWidth={2}
                fill={`url(#gradient-${dataKey})`}
              />
              {limit && (
                <Line
                  type="monotone"
                  dataKey="limit"
                  stroke="#ef4444"
                  strokeWidth={2}
                  strokeDasharray="5 5"
                  dot={false}
                />
              )}
            </AreaChart>
          ) : (
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis
                dataKey="time"
                stroke="#6b7280"
                fontSize={11}
                tickLine={false}
              />
              <YAxis
                stroke="#6b7280"
                fontSize={11}
                tickLine={false}
                domain={[0, limit ? limit * 1.1 : 'auto']}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: 'white',
                  border: '1px solid #e5e7eb',
                  borderRadius: '6px',
                  fontSize: '12px'
                }}
                formatter={(value: number | string) => [`${value}${unit}`, title]}
              />
              <Line
                type="monotone"
                dataKey={dataKey}
                stroke={color}
                strokeWidth={2}
                dot={false}
              />
              {limit && (
                <Line
                  type="monotone"
                  dataKey="limit"
                  stroke="#ef4444"
                  strokeWidth={2}
                  strokeDasharray="5 5"
                  dot={false}
                />
              )}
            </LineChart>
          )}
        </ResponsiveContainer>

        {/* Legend */}
        <div className="flex items-center justify-center gap-4 mt-2 text-xs">
          <div className="flex items-center gap-1">
            <div className="w-3 h-0.5" style={{ backgroundColor: color }} />
            <span className="text-muted-foreground">Actual</span>
          </div>
          {limit && (
            <div className="flex items-center gap-1">
              <div className="w-3 h-0.5 border-t-2 border-dashed border-red-500" />
              <span className="text-muted-foreground">Limit ({limit}{unit})</span>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
