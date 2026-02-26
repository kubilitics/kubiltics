import { useEffect, useState, useCallback } from 'react';
import { DataPoint } from './useAnomalyDetection';
import * as aiService from '@/services/aiService';

export interface ForecastPoint {
  timestamp: string;
  value: number;
  lower_95: number;
  upper_95: number;
}

export interface ForecastModelInfo {
  order: number[];
  fitted: boolean;
  ar_coeffs: number[];
  ma_coeffs: number[];
  constant: number;
  std_error: number;
  n_residuals: number;
}

export interface UseTimeSeriesForecastOptions {
  metricName: string;
  metricType: 'cpu' | 'memory' | 'network' | 'disk' | 'custom';
  data: DataPoint[];
  forecastSteps?: number;
  model?: 'arima' | 'auto';
  arimaOrder?: [number, number, number]; // [p, d, q]
  enabled?: boolean;
  refreshInterval?: number;
}

export interface UseTimeSeriesForecastResult {
  forecasts: ForecastPoint[];
  modelInfo: ForecastModelInfo | null;
  stdError: number;
  isLoading: boolean;
  error: string | null;
  refresh: () => void;
}

export function useTimeSeriesForecast(
  options: UseTimeSeriesForecastOptions
): UseTimeSeriesForecastResult {
  const {
    metricName,
    metricType,
    data,
    forecastSteps = 10,
    model = 'arima',
    arimaOrder = [1, 1, 1],
    enabled = true,
    refreshInterval = 120000 // 2 minutes default
  } = options;

  const [forecasts, setForecasts] = useState<ForecastPoint[]>([]);
  const [modelInfo, setModelInfo] = useState<ForecastModelInfo | null>(null);
  const [stdError, setStdError] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generateForecast = useCallback(async () => {
    if (!enabled || data.length < 20) {
      // Need at least 20 data points for reliable forecasting
      setForecasts([]);
      setModelInfo(null);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const result = await aiService.getTimeSeriesForecast({
        time_series: {
          metric_name: metricName,
          metric_type: metricType,
          data: data.map(d => ({
            timestamp: d.timestamp,
            value: d.value
          }))
        },
        forecast_steps: forecastSteps,
        model,
        arima_order: arimaOrder
      });

      setForecasts(result.forecasts || []);
      setModelInfo(result.model_info || null);
      setStdError(result.std_error || 0);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error occurred';
      setError(errorMessage);
      console.error('Time series forecast error:', err);
    } finally {
      setIsLoading(false);
    }
  }, [enabled, data, metricName, metricType, forecastSteps, model, JSON.stringify(arimaOrder)]);

  useEffect(() => {
    generateForecast();

    if (refreshInterval > 0 && enabled) {
      const interval = setInterval(generateForecast, refreshInterval);
      return () => clearInterval(interval);
    }
  }, [generateForecast, refreshInterval, enabled]);

  return {
    forecasts,
    modelInfo,
    stdError,
    isLoading,
    error,
    refresh: generateForecast
  };
}
