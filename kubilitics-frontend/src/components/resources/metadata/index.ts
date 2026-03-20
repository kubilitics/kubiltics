/**
 * Unified Metadata Rendering System for Kubilitics.
 *
 * All resource detail pages MUST use these components for metadata rendering.
 * No inline label/annotation/taint/toleration rendering is permitted.
 */

// Composite
export { MetadataSection, type MetadataSectionProps } from './MetadataSection';

// Individual components
export { LabelList, type LabelListProps } from './LabelList';
export { AnnotationList, type AnnotationListProps } from './AnnotationList';
export { TaintsList, type TaintsListProps } from './TaintsList';
export { TolerationsList, type TolerationsListProps } from './TolerationsList';

// Types
export type {
  K8sLabel,
  K8sAnnotation,
  K8sTaint,
  K8sToleration,
  K8sOwnerReference,
  K8sMetadata,
} from './types';

// Utilities
export {
  LABEL_COLORS,
  TAINT_EFFECT_COLORS,
  hashKey,
  getLabelColor,
  getTaintEffectColor,
  labelsFromRecord,
  annotationsFromRecord,
  taintsFromSpec,
  tolerationsFromSpec,
  TOLERATION_EFFECT_TOOLTIPS,
} from './utils';
