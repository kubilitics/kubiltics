import { useEffect, useState, useCallback } from 'react';
import { DataPoint } from './useAnomalyDetection';
import * as aiService from '@/services/aiService';

export interface Trend {
  direction: 'increasing' | 'decreasing' | 'stable';
  slope: number;
  r_squared: number;
  confidence: 'high' | 'medium' | 'low';
  forecast: number[];
  forecast_timestamps: string[];
}

export interface UseTrendAnalysisOptions {
  metricName: string;
  metricType: 'cpu' | 'memory' | 'network' | 'disk' | 'custom';
  data: DataPoint[];
  forecastSteps?: number;
  enabled?: boolean;
  refreshInterval?: number;
}

export interface UseTrendAnalysisResult {
  trend: Trend | null;
  isLoading: boolean;
  error: string | null;
  refresh: () => void;
}

export function useTrendAnalysis(options: UseTrendAnalysisOptions): UseTrendAnalysisResult {
  const {
    metricName,
    metricType,
    data,
    forecastSteps = 10,
    enabled = true,
    refreshInterval = 60000 // 1 minute default
  } = options;

  const [trend, setTrend] = useState<Trend | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const analyzeTrend = useCallback(async () => {
    if (!enabled || data.length < 3) {
      setTrend(null);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const result = await aiService.analyzeTrends({
        time_series: {
          metric_name: metricName,
          metric_type: metricType,
          data: data.map(d => ({
            timestamp: d.timestamp,
            value: d.value
          }))
        },
        forecast_steps: forecastSteps
      });

      setTrend(result.trend);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error occurred';
      setError(errorMessage);
      console.error('Trend analysis error:', err);
    } finally {
      setIsLoading(false);
    }
  }, [enabled, data, metricName, metricType, forecastSteps]);

  useEffect(() => {
    analyzeTrend();

    if (refreshInterval > 0 && enabled) {
      const interval = setInterval(analyzeTrend, refreshInterval);
      return () => clearInterval(interval);
    }
  }, [analyzeTrend, refreshInterval, enabled]);

  return {
    trend,
    isLoading,
    error,
    refresh: analyzeTrend
  };
}
