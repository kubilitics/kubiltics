import { useEffect, useState } from 'react';

export interface ResourceHealth {
  resourceId: string;
  healthScore: number; // 0-100
  efficiency: number; // 0-100
  failureRisk: 'low' | 'medium' | 'high' | 'critical';
  costPerDay: number;
  status: 'healthy' | 'warning' | 'critical' | 'unknown';
  issues: string[];
  recommendations: string[];
}

export interface UseResourceHealthOptions {
  resources: Array<{
    id: string;
    type: string;
    namespace?: string;
    name: string;
    metrics?: {
      cpu?: number;
      memory?: number;
      restarts?: number;
      age?: number;
    };
  }>;
  enabled?: boolean;
  refreshInterval?: number;
}

export interface UseResourceHealthResult {
  healthData: Map<string, ResourceHealth>;
  isLoading: boolean;
  error: string | null;
  refresh: () => void;
}

// Calculate health score based on metrics
function calculateHealthScore(resource: any): number {
  let score = 100;

  // Deduct for high CPU usage
  if (resource.metrics?.cpu > 80) score -= 20;
  else if (resource.metrics?.cpu > 60) score -= 10;

  // Deduct for high memory usage
  if (resource.metrics?.memory > 80) score -= 20;
  else if (resource.metrics?.memory > 60) score -= 10;

  // Deduct for restart count
  if (resource.metrics?.restarts > 10) score -= 30;
  else if (resource.metrics?.restarts > 5) score -= 15;
  else if (resource.metrics?.restarts > 0) score -= 5;

  return Math.max(0, Math.min(100, score));
}

// Calculate efficiency score
function calculateEfficiency(resource: any): number {
  const cpu = resource.metrics?.cpu || 0;
  const memory = resource.metrics?.memory || 0;

  // Ideal range is 50-80% utilization
  const cpuEfficiency = cpu >= 50 && cpu <= 80 ? 100 :
                        cpu < 50 ? cpu * 2 :
                        Math.max(0, 100 - (cpu - 80) * 2);

  const memoryEfficiency = memory >= 50 && memory <= 80 ? 100 :
                          memory < 50 ? memory * 2 :
                          Math.max(0, 100 - (memory - 80) * 2);

  return Math.round((cpuEfficiency + memoryEfficiency) / 2);
}

// Determine failure risk
function calculateFailureRisk(resource: any): 'low' | 'medium' | 'high' | 'critical' {
  const restarts = resource.metrics?.restarts || 0;
  const cpu = resource.metrics?.cpu || 0;
  const memory = resource.metrics?.memory || 0;

  if (restarts > 10 || cpu > 90 || memory > 90) return 'critical';
  if (restarts > 5 || cpu > 80 || memory > 80) return 'high';
  if (restarts > 2 || cpu > 70 || memory > 70) return 'medium';
  return 'low';
}

// Estimate cost per day (simplified calculation)
function calculateCostPerDay(resource: any): number {
  const cpu = resource.metrics?.cpu || 0;
  const memory = resource.metrics?.memory || 0;

  // Rough estimate: $0.04 per vCPU-hour, $0.005 per GB-hour
  // Assuming 1 vCPU = 100% CPU, 1 GB = 1000 MB
  const cpuCost = (cpu / 100) * 0.04 * 24;
  const memoryCost = (memory / 1000) * 0.005 * 24;

  return Number((cpuCost + memoryCost).toFixed(2));
}

// Determine status
function determineStatus(healthScore: number, failureRisk: string): ResourceHealth['status'] {
  if (failureRisk === 'critical' || healthScore < 30) return 'critical';
  if (failureRisk === 'high' || healthScore < 60) return 'warning';
  if (healthScore >= 80) return 'healthy';
  return 'unknown';
}

// Generate issues
function generateIssues(resource: any): string[] {
  const issues: string[] = [];

  if (resource.metrics?.cpu > 80) {
    issues.push(`High CPU usage: ${resource.metrics.cpu}%`);
  }

  if (resource.metrics?.memory > 80) {
    issues.push(`High memory usage: ${resource.metrics.memory}%`);
  }

  if (resource.metrics?.restarts > 5) {
    issues.push(`Frequent restarts: ${resource.metrics.restarts} times`);
  }

  return issues;
}

// Generate recommendations
function generateRecommendations(resource: any, efficiency: number): string[] {
  const recommendations: string[] = [];

  if (resource.metrics?.cpu > 80) {
    recommendations.push('Consider increasing CPU limits');
  } else if (resource.metrics?.cpu < 20) {
    recommendations.push('CPU is underutilized, consider reducing requests');
  }

  if (resource.metrics?.memory > 80) {
    recommendations.push('Consider increasing memory limits');
  } else if (resource.metrics?.memory < 20) {
    recommendations.push('Memory is underutilized, consider reducing requests');
  }

  if (efficiency < 50) {
    recommendations.push('Resource allocation is inefficient');
  }

  if (resource.metrics?.restarts > 5) {
    recommendations.push('Investigate cause of frequent restarts');
  }

  return recommendations;
}

export function useResourceHealth(options: UseResourceHealthOptions): UseResourceHealthResult {
  const { resources, enabled = true, refreshInterval = 60000 } = options;

  const [healthData, setHealthData] = useState<Map<string, ResourceHealth>>(new Map());
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const calculateHealth = () => {
    if (!enabled || resources.length === 0) {
      setHealthData(new Map());
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const newHealthData = new Map<string, ResourceHealth>();

      resources.forEach(resource => {
        const healthScore = calculateHealthScore(resource);
        const efficiency = calculateEfficiency(resource);
        const failureRisk = calculateFailureRisk(resource);
        const costPerDay = calculateCostPerDay(resource);
        const status = determineStatus(healthScore, failureRisk);
        const issues = generateIssues(resource);
        const recommendations = generateRecommendations(resource, efficiency);

        newHealthData.set(resource.id, {
          resourceId: resource.id,
          healthScore,
          efficiency,
          failureRisk,
          costPerDay,
          status,
          issues,
          recommendations
        });
      });

      setHealthData(newHealthData);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error occurred';
      setError(errorMessage);
      console.error('Resource health calculation error:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    calculateHealth();

    if (refreshInterval > 0) {
      const interval = setInterval(calculateHealth, refreshInterval);
      return () => clearInterval(interval);
    }
  }, [JSON.stringify(resources.map(r => r.id)), enabled, refreshInterval]);

  return {
    healthData,
    isLoading,
    error,
    refresh: calculateHealth
  };
}
