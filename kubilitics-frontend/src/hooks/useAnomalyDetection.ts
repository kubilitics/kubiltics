import { useEffect, useState } from 'react';
import { detectAnomalies as detectAnomaliesService } from '@/services/aiService';

export interface DataPoint {
  timestamp: string;
  value: number;
}

export interface Anomaly {
  timestamp: string;
  value: number;
  expected_value: number;
  deviation: number;
  severity: 'low' | 'medium' | 'high' | 'critical';
  type: 'spike' | 'drop' | 'outlier' | 'trend' | 'flapping' | 'plateau';
  message: string;
}

export interface UseAnomalyDetectionOptions {
  metricName: string;
  metricType: 'cpu' | 'memory' | 'network' | 'disk' | 'custom';
  data: DataPoint[];
  sensitivity?: 'high' | 'medium' | 'low';
  enabled?: boolean;
  refreshInterval?: number; // in milliseconds
}

export interface UseAnomalyDetectionResult {
  anomalies: Anomaly[];
  isLoading: boolean;
  error: string | null;
  refresh: () => void;
}

export function useAnomalyDetection(options: UseAnomalyDetectionOptions): UseAnomalyDetectionResult {
  const {
    metricName,
    metricType,
    data,
    sensitivity = 'medium',
    enabled = true,
    refreshInterval = 30000 // 30 seconds default
  } = options;

  const [anomalies, setAnomalies] = useState<Anomaly[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const detectAnomalies = async () => {
    if (!enabled || data.length === 0) {
      setAnomalies([]);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const result = await detectAnomaliesService({
        time_series: {
          metric_name: metricName,
          metric_type: metricType,
          data: data.map(d => ({
            timestamp: d.timestamp,
            value: d.value
          }))
        },
        sensitivity
      });
      setAnomalies(result.anomalies || []);
      setAnomalies(result.anomalies || []);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error occurred';
      setError(errorMessage);
      console.error('Anomaly detection error:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    detectAnomalies();

    if (refreshInterval > 0) {
      const interval = setInterval(detectAnomalies, refreshInterval);
      return () => clearInterval(interval);
    }
  }, [metricName, metricType, JSON.stringify(data), sensitivity, enabled, refreshInterval]);

  return {
    anomalies,
    isLoading,
    error,
    refresh: detectAnomalies
  };
}
