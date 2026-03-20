/**
 * Available insight overlay types
 */
export type OverlayType = 'health' | 'cost' | 'security' | 'performance' | 'dependency' | 'traffic';

/**
 * Overlay data containing values for nodes and edges
 */
export interface OverlayData {
  /** Type of overlay */
  type: OverlayType;

  /** Node values (nodeId → value in range 0-100) */
  nodeValues: Map<string, number>;

  /** Edge values (edgeId → value in range 0-100) */
  edgeValues?: Map<string, number>;

  /** Additional metadata */
  metadata?: Record<string, any>;

  /** Timestamp when data was generated */
  timestamp?: number;
}

/**
 * Configuration for an overlay
 */
export interface OverlayConfig {
  /** Is this overlay enabled? */
  enabled: boolean;

  /** Opacity of overlay visualization (0-1) */
  opacity?: number;

  /** Color scheme to use */
  colorScheme?: 'cool' | 'warm' | 'spectral' | 'monochrome';

  /** Should overlay animate? */
  animated?: boolean;

  /** Animation speed (0.5 = half speed, 2.0 = double speed) */
  animationSpeed?: number;
}

/**
 * Color schemes for overlays
 */
export const OVERLAY_COLOR_SCHEMES = {
  health: {
    critical: '#E53935',  // Red - Critical health
    warning: '#FFC107',   // Yellow - Warning
    healthy: '#4CAF50',   // Green - Healthy
  },
  cost: {
    expensive: '#FF5252', // Red - Expensive
    moderate: '#FFC107',  // Yellow - Moderate
    cheap: '#4CAF50',     // Green - Cheap
  },
  security: {
    vulnerable: '#E53935',  // Red - Vulnerable
    exposed: '#FFC107',     // Yellow - Exposed
    secure: '#4CAF50',      // Green - Secure
  },
  performance: {
    slow: '#FF5252',      // Red - Slow/High utilization
    moderate: '#FFC107',  // Yellow - Moderate
    fast: '#4CAF50',      // Green - Fast/Low utilization
  },
  dependency: {
    critical: '#FF5252',  // Red - Critical dependency
    important: '#FFC107', // Yellow - Important
    optional: '#4CAF50',  // Green - Optional
  },
  traffic: {
    high: '#FF5252',      // Red - High traffic
    medium: '#FFC107',    // Yellow - Medium traffic
    low: '#4CAF50',       // Green - Low traffic
  },
} as const;

/**
 * Helper function to get color for a value in range 0-100
 */
export function getOverlayColor(overlayType: OverlayType, value: number): string {
  const scheme = OVERLAY_COLOR_SCHEMES[overlayType];

  if (value >= 70) {
    return Object.values(scheme)[0]; // Critical/High
  } else if (value >= 40) {
    return Object.values(scheme)[1]; // Warning/Medium
  } else {
    return Object.values(scheme)[2]; // Healthy/Low
  }
}

/**
 * Labels for overlay types (for UI display)
 */
export const OVERLAY_LABELS: Record<OverlayType, string> = {
  health: 'Health',
  cost: 'Cost',
  security: 'Security',
  performance: 'Performance',
  dependency: 'Dependency',
  traffic: 'Traffic',
};

/**
 * Descriptions for overlay types
 */
export const OVERLAY_DESCRIPTIONS: Record<OverlayType, string> = {
  health: 'Shows resource health status and error states',
  cost: 'Displays estimated cost per resource',
  security: 'Highlights security issues (RBAC, network policies, exposed services)',
  performance: 'Visualizes CPU and memory utilization',
  dependency: 'Shows relationship criticality and impact',
  traffic: 'Animates live request flows and bandwidth',
};
