import { useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Activity, Clock, CheckCircle, AlertTriangle, Download, Trash2, Network, Server, GitCompare } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { downloadResourceJson } from '@/lib/exportUtils';
import { normalizeKindForTopology } from '@/utils/resourceKindMapper';
import {
  ResourceDetailLayout,
  ResourceOverviewMetadata,
  YamlViewer,
  EventsSection,
  ActionsSection,
  DeleteConfirmDialog,
  ResourceTopologyView,
  ResourceComparisonView,
  type ResourceStatus,
} from '@/components/resources';
import { useResourceEvents } from '@/hooks/useK8sResourceDetail';

const mockComponentStatus = {
  name: 'etcd-0',
  status: 'Healthy' as ResourceStatus,
  age: '180d',
  conditions: [
    { type: 'Healthy', status: 'True', message: '{"health":"true","reason":""}', error: '' },
  ],
};

const yaml = `apiVersion: v1
kind: ComponentStatus
metadata:
  name: etcd-0
conditions:
- type: Healthy
  status: "True"
  message: '{"health":"true","reason":""}'`;

export default function ComponentStatusDetail() {
  const { name } = useParams();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('overview');
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const { events } = useResourceEvents('ComponentStatus', undefined, name ?? undefined);
  const cs = mockComponentStatus;

  const handleDownloadYaml = useCallback(() => {
    const blob = new Blob([yaml], { type: 'application/yaml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${cs.name || 'componentstatus'}.yaml`;
    a.click();
    URL.revokeObjectURL(url);
  }, [cs.name]);

  const handleDownloadJson = useCallback(() => {
    downloadResourceJson(cs, `${cs.name || 'componentstatus'}.json`);
    toast.success('JSON downloaded');
  }, [cs]);

  const isHealthy = cs.conditions.some(c => c.type === 'Healthy' && c.status === 'True');

  const statusCards = [
    { label: 'Status', value: isHealthy ? 'Healthy' : 'Unhealthy', icon: isHealthy ? CheckCircle : AlertTriangle, iconColor: isHealthy ? 'success' as const : 'error' as const },
    { label: 'Component', value: cs.name, icon: Server, iconColor: 'primary' as const },
    { label: 'Conditions', value: cs.conditions.length, icon: Activity, iconColor: 'info' as const },
    { label: 'Age', value: cs.age, icon: Clock, iconColor: 'muted' as const },
  ];

  const tabs = [
    {
      id: 'overview',
      label: 'Overview',
      content: (
        <div className="space-y-6">
          <ResourceOverviewMetadata metadata={{ name: cs.name }} />
          <div className="grid grid-cols-1 gap-6">
            <Card>
              <CardHeader><CardTitle className="text-base">Component Info</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center gap-4">
                  <div className={`p-4 rounded-full ${isHealthy ? 'bg-green-500/10' : 'bg-red-500/10'}`}>
                    {isHealthy ? (
                      <CheckCircle className="h-8 w-8 text-green-500" />
                    ) : (
                      <AlertTriangle className="h-8 w-8 text-red-500" />
                    )}
                  </div>
                  <div>
                    <h3 className="text-xl font-semibold">{cs.name}</h3>
                    <p className="text-muted-foreground">
                      {isHealthy ? 'Component is healthy and responding normally' : 'Component is experiencing issues'}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="text-base">Conditions</CardTitle></CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {cs.conditions.map((condition, idx) => (
                    <div key={idx} className="p-4 rounded-lg bg-muted/50 space-y-2">
                      <div className="flex items-center justify-between">
                        <Badge variant={condition.status === 'True' ? 'default' : 'destructive'}>
                          {condition.type}
                        </Badge>
                        <Badge variant="outline">{condition.status}</Badge>
                      </div>
                      {condition.message && (
                        <p className="text-sm font-mono text-muted-foreground break-all">
                          {condition.message}
                        </p>
                      )}
                      {condition.error && (
                        <p className="text-sm text-destructive">
                          Error: {condition.error}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      ),
    },
    { id: 'events', label: 'Events', content: <EventsSection events={events} /> },
    { id: 'yaml', label: 'YAML', icon: Server, content: <YamlViewer yaml={yaml} resourceName={cs.name} /> },
    {
      id: 'compare',
      label: 'Compare',
      icon: GitCompare,
      content: (
        <ResourceComparisonView
          resourceType="componentstatuses"
          resourceKind="ComponentStatus"
          initialSelectedResources={[cs.name]}
          isConnected={false} // ComponentStatus is mostly mock/deprecated here
          embedded
        />
      ),
    },
    {
      id: 'topology',
      label: 'Topology',
      icon: Network,
      content: (
        <ResourceTopologyView
          kind={normalizeKindForTopology('ComponentStatus')}
          namespace={''}
          name={name ?? ''}
          sourceResourceType="ComponentStatus"
          sourceResourceName={cs.name ?? name ?? ''}
        />
      ),
    },
    {
      id: 'actions',
      label: 'Actions',
      content: (
        <ActionsSection actions={[
          { icon: Download, label: 'Download YAML', description: 'Export ComponentStatus definition', onClick: handleDownloadYaml },
          { icon: Download, label: 'Export as JSON', description: 'Export ComponentStatus as JSON', onClick: handleDownloadJson },
          { icon: Trash2, label: 'Delete', description: 'Remove this component status', variant: 'destructive', onClick: () => setShowDeleteDialog(true) },
        ]} />
      ),
    },
  ];

  return (
    <>
      <ResourceDetailLayout
        resourceType="ComponentStatus"
        resourceIcon={Activity}
        name={cs.name}
        status={cs.status}
        backLink="/componentstatuses"
        backLabel="Component Statuses"
        createdLabel={cs.age}
        actions={[
          { label: 'Download YAML', icon: Download, variant: 'outline', onClick: handleDownloadYaml },
          { label: 'Export as JSON', icon: Download, variant: 'outline', onClick: handleDownloadJson },
          { label: 'Delete', icon: Trash2, variant: 'destructive', onClick: () => setShowDeleteDialog(true) },
        ]}
        statusCards={statusCards}
        tabs={tabs}
        activeTab={activeTab}
        onTabChange={setActiveTab}
      />
      <DeleteConfirmDialog
        open={showDeleteDialog}
        onOpenChange={setShowDeleteDialog}
        resourceType="ComponentStatus"
        resourceName={cs.name}
        onConfirm={() => {
          toast.success(`ComponentStatus ${cs.name} deleted (demo mode)`);
          navigate('/componentstatuses');
        }}
        requireNameConfirmation
      />
    </>
  );
}
