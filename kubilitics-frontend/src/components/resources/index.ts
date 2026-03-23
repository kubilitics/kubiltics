export { ResourceStatusCard, ResourceStatusCards, type ResourceStatusCardProps, type ResourceStatusCardsProps } from './ResourceStatusCard';
export { ResourceTabs, type TabConfig, type ResourceTabsProps } from './ResourceTabs';
export { LogViewer, type LogEntry, type LogViewerProps } from './LogViewer';
export { TerminalViewer, type TerminalLine, type TerminalViewerProps } from './TerminalViewer';
export { DeleteConfirmDialog, type DeleteConfirmDialogProps } from './DeleteConfirmDialog';
export { PortForwardDialog, type PortInfo, type PortForwardDialogProps } from './PortForwardDialog';
export { ScaleDialog, type ScaleDialogProps } from './ScaleDialog';
export { RolloutActionsDialog, type RolloutRevision, type RolloutActionsDialogProps } from './RolloutActionsDialog';
export { YamlEditorDialog, type YamlEditorDialogProps } from './YamlEditorDialog';
export { MetricsDashboard, type PodResourceForMetrics } from './MetricsDashboard';
export { ResourceDetailLayout, type ResourceDetailLayoutProps } from './ResourceDetailLayout';
export { ResourceHeader, type ResourceHeaderProps, type ResourceAction, type ResourceStatus } from './ResourceHeader';
export { ContainersSection, type ContainerInfo, type ContainersSectionProps } from './ContainersSection';
export { ResourceList, type Column, type ResourceListProps, type ResourceListPagination } from './ResourceList';
export { YamlViewer, type YamlViewerProps, type YamlValidationError } from './YamlViewer';
export { computeDiff, YamlLineContent, getIntraLineDiff, type DiffLine, type YamlVersion } from './YamlDiffUtils';
export { EventsSection, type EventInfo, type EventsSectionProps } from './EventsSection';
export { DetailRow, type DetailRowProps } from './DetailRow';
export { SectionCard, type SectionCardProps } from './SectionCard';
export { MetadataCard, type MetadataCardProps } from './MetadataCard';
/** @deprecated Use MetadataSection from ./metadata instead. */
export { ResourceOverviewMetadata, type ResourceOverviewMetadataProps } from './ResourceOverviewMetadata';
export { ActionsSection, type ActionItem, type ActionsSectionProps } from './ActionsSection';
export { NodeDetailPopup, type ResourceDetail } from './NodeDetailPopup';
export { Sparkline, LiveMetric, useLiveMetrics } from './PodSparkline';
export { UsageBar, parseCpu, parseMemory, calculatePodResourceMax, type UsageBarProps, type UsageBarKind, type UsageBarVariant } from './UsageBar';
export { MetricBar } from './MetricBar';
export { DetailPodTable, type DetailPodTableProps } from './DetailPodTable';
export { ResourceComparisonView } from './ResourceComparisonView';
export { ResourceTopologyView, type ResourceTopologyViewProps } from './ResourceTopologyView';
export { X } from 'lucide-react'; // Export X if needed, or just let users import from lucide-react

// ── Unified Metadata System ──────────────────────────────────────────────
export {
  MetadataSection,
  LabelList,
  AnnotationList,
  TaintsList,
  TolerationsList,
  type MetadataSectionProps,
  type LabelListProps,
  type AnnotationListProps,
  type TaintsListProps,
  type TolerationsListProps,
  type K8sLabel,
  type K8sAnnotation,
  type K8sTaint,
  type K8sToleration,
  type K8sOwnerReference,
  type K8sMetadata,
} from './metadata';
