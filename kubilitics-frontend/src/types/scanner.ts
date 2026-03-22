export type ScanSeverity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO';
export type ScanRunStatus = 'pending' | 'running' | 'completed' | 'failed';
export type FindingStatus = 'open' | 'acknowledged' | 'fixed' | 'false_positive';

export interface ScanRun {
  id: string;
  status: ScanRunStatus;
  target_type: string;
  target_path: string;
  scanners: string;
  total_findings: number;
  critical_count: number;
  high_count: number;
  medium_count: number;
  low_count: number;
  info_count: number;
  duration_ms: number;
  error_message?: string;
  started_at?: string;
  completed_at?: string;
  created_at: string;
}

export interface ScanFinding {
  id: string;
  run_id: string;
  tool: string;
  rule_id: string;
  severity: ScanSeverity;
  title: string;
  description?: string;
  file_path?: string;
  start_line: number;
  end_line: number;
  remediation?: string;
  cwe?: string;
  cve?: string;
  confidence?: string;
  metadata_raw?: string;
  status: FindingStatus;
  first_seen_at: string;
  last_seen_at: string;
}

export interface ScanStats {
  total_runs: number;
  total_findings: number;
  findings_by_severity: Record<string, number>;
  findings_by_tool: Record<string, number>;
  trend: ScanTrend[];
}

export interface ScanTrend {
  date: string;
  critical: number;
  high: number;
  medium: number;
  low: number;
  info: number;
}

export interface ScannerTool {
  name: string;
  available: boolean;
}

export interface PaginatedResponse<T> {
  total: number;
  runs?: T[];
  findings?: T[];
}
