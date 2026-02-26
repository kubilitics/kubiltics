import { useState, useEffect, useCallback } from 'react';
import { scanImage } from '@/services/aiService';

export interface Vulnerability {
  cve_id: string;
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  score: number;
  package: string;
  version: string;
  fixed_version: string;
  description: string;
  published_date: string;
  references: string[];
}

export interface ImageScanResult {
  image: string;
  scan_time: string;
  vulnerabilities: Vulnerability[];
  vulnerability_count: number;
  critical_count: number;
  high_count: number;
  medium_count: number;
  low_count: number;
  info_count: number;
  risk_score: number;
  risk_level: 'critical' | 'high' | 'medium' | 'low';
}

export interface UseSecurityScanOptions {
  image?: string;
  minSeverity?: 'critical' | 'high' | 'medium' | 'low' | 'info';
  includeFixes?: boolean;
  autoScan?: boolean;
  refreshInterval?: number;
}

export interface UseSecurityScanResult {
  scanResult: ImageScanResult | null;
  isLoading: boolean;
  error: Error | null;
  scan: (image: string) => Promise<void>;
  refresh: () => Promise<void>;
}


// Service call replaces direct fetch to handle dynamic backend URLs

export function useSecurityScan(options: UseSecurityScanOptions = {}): UseSecurityScanResult {
  const {
    image,
    minSeverity,
    includeFixes = false,
    autoScan = false,
    refreshInterval,
  } = options;

  const [scanResult, setScanResult] = useState<ImageScanResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const scan = useCallback(async (imageName: string) => {
    if (!imageName) {
      setError(new Error('Image name is required'));
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const data = await scanImage({
        image: imageName,
        min_severity: minSeverity,
        include_fixes: includeFixes,
      });
      setScanResult(data);
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Unknown error'));
      setScanResult(null);
    } finally {
      setIsLoading(false);
    }
  }, [minSeverity, includeFixes]);

  const refresh = useCallback(async () => {
    if (image) {
      await scan(image);
    }
  }, [image, scan]);

  // Auto-scan on mount if image provided and autoScan enabled
  useEffect(() => {
    if (autoScan && image) {
      scan(image);
    }
  }, [autoScan, image, scan]);

  // Refresh interval
  useEffect(() => {
    if (refreshInterval && image) {
      const interval = setInterval(() => {
        scan(image);
      }, refreshInterval);

      return () => clearInterval(interval);
    }
  }, [refreshInterval, image, scan]);

  return {
    scanResult,
    isLoading,
    error,
    scan,
    refresh,
  };
}
