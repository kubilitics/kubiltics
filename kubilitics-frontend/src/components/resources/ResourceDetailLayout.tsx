import { ReactNode } from 'react';
import { LucideIcon } from 'lucide-react';
import { ResourceHeader, ResourceAction, ResourceStatus } from './ResourceHeader';
import { ResourceStatusCards, ResourceStatusCardProps } from './ResourceStatusCard';
import { ResourceTabs, TabConfig } from './ResourceTabs';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';

export interface ResourceDetailLayoutProps {
  resourceType: string;
  resourceIcon: LucideIcon;
  name: string;
  namespace?: string;
  status: ResourceStatus;
  backLink: string;
  backLabel: string;
  actions?: ResourceAction[];
  headerMetadata?: ReactNode;
  /** Relative created label (e.g. "2h ago") for header */
  createdLabel?: string;
  /** ISO timestamp for created tooltip */
  createdAt?: string;
  statusCards: ResourceStatusCardProps[];
  tabs: TabConfig[];
  activeTab: string;
  onTabChange: (tabId: string) => void;
  children?: ReactNode;
  className?: string;
}

/**
 * Universal layout for Kubernetes resource detail pages: header, status cards, and tabs
 * with consistent motion and spacing.
 */
export function ResourceDetailLayout({
  resourceType,
  resourceIcon,
  name,
  namespace,
  status,
  backLink,
  backLabel,
  actions,
  headerMetadata,
  createdLabel,
  createdAt,
  statusCards,
  tabs,
  activeTab,
  onTabChange,
  children,
  className,
}: ResourceDetailLayoutProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      transition={{ duration: 0.3, ease: 'easeOut' }}
      className={cn('space-y-6', className)}
    >
      {children}
      <ResourceHeader
        resourceType={resourceType}
        resourceIcon={resourceIcon}
        name={name}
        namespace={namespace}
        status={status}
        backLink={backLink}
        backLabel={backLabel}
        actions={actions}
        metadata={headerMetadata}
        createdLabel={createdLabel}
        createdAt={createdAt}
      />
      <ResourceStatusCards cards={statusCards} />
      <ResourceTabs tabs={tabs} activeTab={activeTab} onTabChange={onTabChange} className="pt-2" />
    </motion.div>
  );
}
