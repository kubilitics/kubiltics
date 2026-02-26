import { useEffect, useState, useCallback } from 'react';
import { DataPoint } from './useAnomalyDetection';
import * as aiService from '@/services/aiService';

export interface MLAnomaly {
  timestamp: string;
  value: number;
  score: number; // 0.0 to 1.0
  severity: 'low' | 'medium' | 'high' | 'critical';
  explanation: string;
  path_length?: number;
}

export interface MLModelInfo {
  algorithm: string;
  num_trees: number;
  sample_size: number;
  threshold: number;
  total_points: number;
}

export interface UseMLAnomalyDetectionOptions {
  metricName: string;
  metricType: 'cpu' | 'memory' | 'network' | 'disk' | 'custom';
  data: DataPoint[];
  algorithm?: 'isolation_forest' | 'ensemble';
  sensitivity?: number; // 0.0 to 1.0
  numTrees?: number;
  sampleSize?: number;
  enabled?: boolean;
  refreshInterval?: number;
}

export interface UseMLAnomalyDetectionResult {
  anomalies: MLAnomaly[];
  modelInfo: MLModelInfo | null;
  isLoading: boolean;
  error: string | null;
  refresh: () => void;
}

export function useMLAnomalyDetection(
  options: UseMLAnomalyDetectionOptions
): UseMLAnomalyDetectionResult {
  const {
    metricName,
    metricType,
    data,
    algorithm = 'isolation_forest',
    sensitivity = 0.6,
    numTrees = 100,
    sampleSize = 256,
    enabled = true,
    refreshInterval = 60000 // 1 minute default
  } = options;

  const [anomalies, setAnomalies] = useState<MLAnomaly[]>([]);
  const [modelInfo, setModelInfo] = useState<MLModelInfo | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const detectAnomalies = useCallback(async () => {
    if (!enabled || data.length < 10) {
      setAnomalies([]);
      setModelInfo(null);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const result = await aiService.detectMLAnomalies({
        time_series: {
          metric_name: metricName,
          metric_type: metricType,
          data: data.map(d => ({
            timestamp: d.timestamp,
            value: d.value
          }))
        },
        algorithm,
        sensitivity,
        num_trees: numTrees,
        sample_size: sampleSize
      });

      setAnomalies(result.anomalies || []);
      setModelInfo(result.model_info || null);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error occurred';
      setError(errorMessage);
      console.error('ML anomaly detection error:', err);
    } finally {
      setIsLoading(false);
    }
  }, [enabled, data, metricName, metricType, algorithm, sensitivity, numTrees, sampleSize]);

  useEffect(() => {
    detectAnomalies();

    if (refreshInterval > 0 && enabled) {
      const interval = setInterval(detectAnomalies, refreshInterval);
      return () => clearInterval(interval);
    }
  }, [detectAnomalies, refreshInterval, enabled]);

  return {
    anomalies,
    modelInfo,
    isLoading,
    error,
    refresh: detectAnomalies
  };
}
