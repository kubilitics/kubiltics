import { useState, useCallback } from 'react';
import { checkCompliance } from '@/services/aiService';

export type ComplianceStandard = 'cis_kubernetes' | 'pod_security_standard' | 'nist' | 'soc2';
export type ComplianceStatus = 'pass' | 'fail' | 'warning' | 'not_applicable';

export interface ComplianceCheck {
  id: string;
  standard: ComplianceStandard;
  section: string;
  title: string;
  description: string;
  status: ComplianceStatus;
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  details: string;
  remediation: string;
  resource?: string;
  namespace?: string;
  timestamp: string;
}

export interface ComplianceReport {
  standard: ComplianceStandard;
  total_checks: number;
  passed_checks: number;
  failed_checks: number;
  warning_checks: number;
  compliance_score: number;
  checks: ComplianceCheck[];
  timestamp: string;
}

export interface PodComplianceConfig {
  name: string;
  namespace: string;
  run_as_non_root?: boolean;
  run_as_user?: number;
  read_only_root_fs?: boolean;
  privileged?: boolean;
  allow_privilege_escalation?: boolean;
  capabilities?: {
    add?: string[];
    drop?: string[];
  };
}

export interface RBACComplianceConfig {
  role_name: string;
  rules: Array<{
    verbs: string[];
    resources: string[];
    api_groups: string[];
  }>;
}

export interface UseComplianceCheckOptions {
  standard?: ComplianceStandard;
  autoCheck?: boolean;
}

export interface UseComplianceCheckResult {
  report: ComplianceReport | null;
  isLoading: boolean;
  error: Error | null;
  checkPod: (config: PodComplianceConfig) => Promise<void>;
  checkRBAC: (config: RBACComplianceConfig) => Promise<void>;
  refresh: () => Promise<void>;
}


// Service calls replace direct fetch to handle dynamic backend URLs

export function useComplianceCheck(
  options: UseComplianceCheckOptions = {}
): UseComplianceCheckResult {
  const { standard = 'cis_kubernetes' } = options;

  const [report, setReport] = useState<ComplianceReport | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [lastConfig, setLastConfig] = useState<{
    type: 'pod' | 'rbac';
    config: PodComplianceConfig | RBACComplianceConfig;
  } | null>(null);

  const checkPod = useCallback(
    async (config: PodComplianceConfig) => {
      if (!config.name) {
        setError(new Error('Pod name is required'));
        return;
      }

      setIsLoading(true);
      setError(null);
      setLastConfig({ type: 'pod', config });

      try {
        const data = await checkCompliance({
          standard,
          resource_type: 'pod',
          pod: config,
        });
        setReport(data);
      } catch (err) {
        setError(err instanceof Error ? err : new Error('Unknown error'));
        setReport(null);
      } finally {
        setIsLoading(false);
      }
    },
    [standard]
  );

  const checkRBAC = useCallback(
    async (config: RBACComplianceConfig) => {
      if (!config.role_name) {
        setError(new Error('Role name is required'));
        return;
      }

      setIsLoading(true);
      setError(null);
      setLastConfig({ type: 'rbac', config });

      try {
        const data = await checkCompliance({
          standard,
          resource_type: 'rbac',
          rbac: config,
        });
        setReport(data);
      } catch (err) {
        setError(err instanceof Error ? err : new Error('Unknown error'));
        setReport(null);
      } finally {
        setIsLoading(false);
      }
    },
    [standard]
  );

  const refresh = useCallback(async () => {
    if (lastConfig) {
      if (lastConfig.type === 'pod') {
        await checkPod(lastConfig.config as PodComplianceConfig);
      } else {
        await checkRBAC(lastConfig.config as RBACComplianceConfig);
      }
    }
  }, [lastConfig, checkPod, checkRBAC]);

  return {
    report,
    isLoading,
    error,
    checkPod,
    checkRBAC,
    refresh,
  };
}
