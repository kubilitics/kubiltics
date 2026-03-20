import { useState, useCallback, useMemo } from 'react';
import type { OverlayType, OverlayConfig, OverlayData } from '../types/overlay.types';

export interface UseInsightOverlayOptions {
  /** Initial enabled overlays */
  initialOverlays?: OverlayType[];

  /** Default overlay configuration */
  defaultConfig?: Partial<OverlayConfig>;

  /** Callback when overlay is toggled */
  onOverlayToggle?: (type: OverlayType, enabled: boolean) => void;
}

export interface UseInsightOverlayReturn {
  /** Currently enabled overlays */
  enabledOverlays: Set<OverlayType>;

  /** Overlay configurations */
  overlayConfigs: Map<OverlayType, OverlayConfig>;

  /** Overlay data */
  overlayData: Map<OverlayType, OverlayData>;

  /** Toggle an overlay on/off */
  toggleOverlay: (type: OverlayType) => void;

  /** Enable an overlay */
  enableOverlay: (type: OverlayType) => void;

  /** Disable an overlay */
  disableOverlay: (type: OverlayType) => void;

  /** Check if overlay is enabled */
  isOverlayEnabled: (type: OverlayType) => boolean;

  /** Set overlay data */
  setOverlayData: (type: OverlayType, data: OverlayData) => void;

  /** Update overlay configuration */
  updateOverlayConfig: (type: OverlayType, config: Partial<OverlayConfig>) => void;

  /** Clear all overlays */
  clearAllOverlays: () => void;
}

/**
 * Hook for managing insight overlays
 *
 * This hook provides:
 * - Toggle multiple overlays simultaneously
 * - Manage overlay configurations (opacity, color scheme, animation)
 * - Store and retrieve overlay data
 * - Batch updates for performance
 *
 * @example
 * ```tsx
 * const {
 *   enabledOverlays,
 *   toggleOverlay,
 *   setOverlayData,
 * } = useInsightOverlay({
 *   initialOverlays: ['health', 'performance'],
 * });
 *
 * // Toggle overlay
 * toggleOverlay('cost');
 *
 * // Set overlay data
 * setOverlayData('health', {
 *   type: 'health',
 *   nodeValues: new Map([['pod-1', 100], ['pod-2', 50]]),
 * });
 * ```
 */
export function useInsightOverlay(
  options: UseInsightOverlayOptions = {}
): UseInsightOverlayReturn {
  const {
    initialOverlays = [],
    defaultConfig = {},
    onOverlayToggle,
  } = options;

  // Enabled overlays state
  const [enabledOverlays, setEnabledOverlays] = useState<Set<OverlayType>>(
    new Set(initialOverlays)
  );

  // Overlay configurations
  const [overlayConfigs, setOverlayConfigs] = useState<Map<OverlayType, OverlayConfig>>(
    () => {
      const configs = new Map<OverlayType, OverlayConfig>();
      const defaultOverlayConfig: OverlayConfig = {
        enabled: false,
        opacity: 0.7,
        colorScheme: 'spectral',
        animated: false,
        animationSpeed: 1.0,
        ...defaultConfig,
      };

      // Initialize all overlay types with default config
      const allOverlayTypes: OverlayType[] = ['health', 'cost', 'security', 'performance', 'dependency', 'traffic'];
      allOverlayTypes.forEach(type => {
        configs.set(type, {
          ...defaultOverlayConfig,
          enabled: initialOverlays.includes(type),
        });
      });

      return configs;
    }
  );

  // Overlay data
  const [overlayData, setOverlayDataState] = useState<Map<OverlayType, OverlayData>>(
    new Map()
  );

  // Toggle overlay
  const toggleOverlay = useCallback((type: OverlayType) => {
    setEnabledOverlays(prev => {
      const newSet = new Set(prev);
      if (newSet.has(type)) {
        newSet.delete(type);
      } else {
        newSet.add(type);
      }
      return newSet;
    });

    setOverlayConfigs(prev => {
      const newMap = new Map(prev);
      const config = newMap.get(type);
      if (config) {
        newMap.set(type, { ...config, enabled: !config.enabled });
      }
      return newMap;
    });

    const isEnabled = !enabledOverlays.has(type);
    onOverlayToggle?.(type, isEnabled);
  }, [enabledOverlays, onOverlayToggle]);

  // Enable overlay
  const enableOverlay = useCallback((type: OverlayType) => {
    if (!enabledOverlays.has(type)) {
      toggleOverlay(type);
    }
  }, [enabledOverlays, toggleOverlay]);

  // Disable overlay
  const disableOverlay = useCallback((type: OverlayType) => {
    if (enabledOverlays.has(type)) {
      toggleOverlay(type);
    }
  }, [enabledOverlays, toggleOverlay]);

  // Check if overlay is enabled
  const isOverlayEnabled = useCallback((type: OverlayType) => {
    return enabledOverlays.has(type);
  }, [enabledOverlays]);

  // Set overlay data
  const setOverlayData = useCallback((type: OverlayType, data: OverlayData) => {
    setOverlayDataState(prev => {
      const newMap = new Map(prev);
      newMap.set(type, data);
      return newMap;
    });
  }, []);

  // Update overlay configuration
  const updateOverlayConfig = useCallback((type: OverlayType, config: Partial<OverlayConfig>) => {
    setOverlayConfigs(prev => {
      const newMap = new Map(prev);
      const existingConfig = newMap.get(type);
      if (existingConfig) {
        newMap.set(type, { ...existingConfig, ...config });
      }
      return newMap;
    });
  }, []);

  // Clear all overlays
  const clearAllOverlays = useCallback(() => {
    setEnabledOverlays(new Set());
    setOverlayConfigs(prev => {
      const newMap = new Map(prev);
      newMap.forEach((config, type) => {
        newMap.set(type, { ...config, enabled: false });
      });
      return newMap;
    });
  }, []);

  return {
    enabledOverlays,
    overlayConfigs,
    overlayData,
    toggleOverlay,
    enableOverlay,
    disableOverlay,
    isOverlayEnabled,
    setOverlayData,
    updateOverlayConfig,
    clearAllOverlays,
  };
}
