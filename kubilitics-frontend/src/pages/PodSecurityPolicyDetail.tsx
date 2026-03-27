import { useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Shield, Clock, Lock, Download, Trash2, AlertTriangle, Network, GitCompare, Zap, Info, UserCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { toast } from '@/components/ui/sonner';
import { downloadResourceJson } from '@/lib/exportUtils';
import { normalizeKindForTopology } from '@/utils/resourceKindMapper';
import { BlastRadiusTab } from '@/components/resources/BlastRadiusTab';
import {
  ResourceDetailLayout,
  SectionCard,
  DetailRow,
  LabelList,
  AnnotationList,
  YamlViewer,
  EventsSection,
  ActionsSection,
  DeleteConfirmDialog,
  ResourceTopologyView,
  ResourceComparisonView,
  type ResourceStatus,
  type EventInfo,
} from '@/components/resources';

const mockPSP = {
  name: 'restricted',
  status: 'Active' as ResourceStatus,
  age: '180d',
  privileged: false,
  allowPrivilegeEscalation: false,
  requiredDropCapabilities: ['ALL'],
  volumes: ['configMap', 'secret', 'emptyDir', 'persistentVolumeClaim'],
  hostNetwork: false,
  hostPID: false,
  hostIPC: false,
  runAsUser: { rule: 'MustRunAsNonRoot' },
  seLinux: { rule: 'RunAsAny' },
  fsGroup: { rule: 'RunAsAny' },
  supplementalGroups: { rule: 'RunAsAny' },
};

const mockEvents: EventInfo[] = [];

const yaml = `apiVersion: policy/v1beta1
kind: PodSecurityPolicy
metadata:
  name: restricted
spec:
  privileged: false
  allowPrivilegeEscalation: false
  requiredDropCapabilities:
  - ALL
  volumes:
  - 'configMap'
  - 'secret'
  - 'emptyDir'
  - 'persistentVolumeClaim'
  hostNetwork: false
  hostPID: false
  hostIPC: false
  runAsUser:
    rule: MustRunAsNonRoot
  seLinux:
    rule: RunAsAny
  fsGroup:
    rule: RunAsAny
  supplementalGroups:
    rule: RunAsAny`;

export default function PodSecurityPolicyDetail() {
  const { name } = useParams();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('overview');
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const psp = mockPSP;

  const handleDownloadYaml = useCallback(() => {
    const blob = new Blob([yaml], { type: 'application/yaml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${psp.name || 'psp'}.yaml`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  }, [psp.name]);

  const handleDownloadJson = useCallback(() => {
    downloadResourceJson(psp, `${psp.name || 'psp'}.json`);
    toast.success('JSON downloaded');
  }, [psp]);

  const statusCards = [
    { label: 'Privileged', value: psp.privileged ? 'Yes' : 'No', icon: Lock, iconColor: psp.privileged ? 'error' as const : 'success' as const },
    { label: 'Host Network', value: psp.hostNetwork ? 'Yes' : 'No', icon: Shield, iconColor: 'info' as const },
    { label: 'Volumes', value: psp.volumes.length, icon: AlertTriangle, iconColor: 'warning' as const },
    { label: 'Age', value: psp.age, icon: Clock, iconColor: 'muted' as const },
  ];

  const tabs = [
    {
      id: 'overview',
      label: 'Overview',
      content: (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <SectionCard icon={Lock} title="Security Settings">
            <div className="grid grid-cols-2 gap-x-8 gap-y-3">
              <DetailRow
                label="Privileged"
                value={
                  <Badge variant={psp.privileged ? 'destructive' : 'default'}>
                    {psp.privileged ? 'Allowed' : 'Denied'}
                  </Badge>
                }
              />
              <DetailRow
                label="Privilege Escalation"
                value={
                  <Badge variant={psp.allowPrivilegeEscalation ? 'destructive' : 'default'}>
                    {psp.allowPrivilegeEscalation ? 'Allowed' : 'Denied'}
                  </Badge>
                }
              />
              <DetailRow
                label="Host Network"
                value={
                  <Badge variant={psp.hostNetwork ? 'destructive' : 'secondary'}>
                    {psp.hostNetwork ? 'Allowed' : 'Denied'}
                  </Badge>
                }
              />
              <DetailRow
                label="Host PID"
                value={
                  <Badge variant={psp.hostPID ? 'destructive' : 'secondary'}>
                    {psp.hostPID ? 'Allowed' : 'Denied'}
                  </Badge>
                }
              />
            </div>
          </SectionCard>
          <SectionCard icon={UserCircle} title="Run As User">
            <div className="grid grid-cols-2 gap-x-8 gap-y-3">
              <DetailRow label="Run As User Rule" value={<Badge variant="outline">{psp.runAsUser.rule}</Badge>} />
              <DetailRow label="SELinux Rule" value={<Badge variant="outline">{psp.seLinux.rule}</Badge>} />
              <DetailRow label="FS Group Rule" value={<Badge variant="outline">{psp.fsGroup.rule}</Badge>} />
              <DetailRow label="Supplemental Groups" value={<Badge variant="outline">{psp.supplementalGroups.rule}</Badge>} />
            </div>
          </SectionCard>
          <SectionCard icon={Info} title="Allowed Volumes">
            <div className="flex flex-wrap gap-2">
              {psp.volumes.map((vol) => (
                <Badge key={vol} variant="secondary">{vol}</Badge>
              ))}
            </div>
          </SectionCard>
          <SectionCard icon={AlertTriangle} title="Required Drop Capabilities">
            <div className="flex flex-wrap gap-2">
              {psp.requiredDropCapabilities.map((cap) => (
                <Badge key={cap} variant="destructive">{cap}</Badge>
              ))}
            </div>
          </SectionCard>
          <div className="lg:col-span-2">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <LabelList labels={{}} />
            </div>
          </div>
          <div className="lg:col-span-2">
            <AnnotationList annotations={{}} />
          </div>
        </div>
      ),
    },
    { id: 'events', label: 'Events', content: <EventsSection events={mockEvents} /> },
    { id: 'yaml', label: 'YAML', icon: Shield, content: <YamlViewer yaml={yaml} resourceName={psp.name} /> },
    {
      id: 'compare',
      label: 'Compare',
      icon: GitCompare,
      content: (
        <ResourceComparisonView
          resourceType="podsecuritypolicies"
          resourceKind="PodSecurityPolicy"
          initialSelectedResources={[psp.name]}
          isConnected={false} // PSP is mock here
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
          kind={normalizeKindForTopology('PodSecurityPolicy')}
          namespace={''}
          name={name ?? ''}
          sourceResourceType="PodSecurityPolicy"
          sourceResourceName={psp.name ?? name ?? ''}
        />
      ),
    },
    {
      id: 'blast-radius',
      label: 'Blast Radius',
      icon: Zap,
      content: (
        <BlastRadiusTab
          kind={normalizeKindForTopology('PodSecurityPolicy')}
          namespace={''}
          name={name || psp.name || ''}
        />
      ),
    },
    {
      id: 'actions',
      label: 'Actions',
      content: (
        <ActionsSection actions={[
          { icon: Download, label: 'Download YAML', description: 'Export PSP definition', onClick: handleDownloadYaml },
          { icon: Download, label: 'Export as JSON', description: 'Export PSP as JSON', onClick: handleDownloadJson },
          { icon: Trash2, label: 'Delete PSP', description: 'Remove this pod security policy', variant: 'destructive', onClick: () => setShowDeleteDialog(true) },
        ]} />
      ),
    },
  ];

  return (
    <>
      <ResourceDetailLayout
        resourceType="PodSecurityPolicy"
        resourceIcon={Shield}
        name={psp.name}
        status={psp.status}
        backLink="/podsecuritypolicies"
        backLabel="Pod Security Policies"
        headerMetadata={<span className="flex items-center gap-1.5 ml-2 text-sm text-muted-foreground"><Clock className="h-3.5 w-3.5" />Created {psp.age}</span>}
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
        resourceType="PodSecurityPolicy"
        resourceName={psp.name}
        onConfirm={() => {
          toast.success(`PodSecurityPolicy ${psp.name} deleted (demo mode)`);
          navigate('/podsecuritypolicies');
        }}
        requireNameConfirmation
      />
    </>
  );
}
