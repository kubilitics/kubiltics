import {
  CommandDialog as CmdDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command';
import {
  Box,
  Layers,
  Server,
  Globe,
  Database,
  Shield,
  Settings,
  Activity,
  FileText,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';

const resourceGroups = [
  {
    heading: 'Workloads',
    items: [
      { icon: Box, label: 'Pods', path: '/pods' },
      { icon: Layers, label: 'Deployments', path: '/deployments' },
      { icon: Layers, label: 'StatefulSets', path: '/statefulsets' },
      { icon: Layers, label: 'DaemonSets', path: '/daemonsets' },
      { icon: Activity, label: 'Jobs', path: '/jobs' },
      { icon: Activity, label: 'CronJobs', path: '/cronjobs' },
    ],
  },
  {
    heading: 'Networking',
    items: [
      { icon: Globe, label: 'Services', path: '/services' },
      { icon: Globe, label: 'Ingresses', path: '/ingresses' },
      { icon: Shield, label: 'Network Policies', path: '/networkpolicies' },
    ],
  },
  {
    heading: 'Storage & Config',
    items: [
      { icon: Database, label: 'Persistent Volumes', path: '/persistentvolumes' },
      { icon: Database, label: 'Persistent Volume Claims', path: '/persistentvolumeclaims' },
      { icon: Settings, label: 'ConfigMaps', path: '/configmaps' },
      { icon: Shield, label: 'Secrets', path: '/secrets' },
    ],
  },
  {
    heading: 'Cluster',
    items: [
      { icon: Server, label: 'Nodes', path: '/nodes' },
      { icon: FileText, label: 'Namespaces', path: '/namespaces' },
      { icon: Activity, label: 'Events', path: '/events' },
    ],
  },
];

interface CommandDialogProps {
  open: boolean;
  setOpen: (open: boolean) => void;
}

export function CommandDialog({ open, setOpen }: CommandDialogProps) {
  const navigate = useNavigate();

  const handleSelect = (path: string) => {
    navigate(path);
    setOpen(false);
  };

  return (
    <CmdDialog open={open} onOpenChange={setOpen}>
      <CommandInput placeholder="Search resources, pods, deployments..." />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>
        
        {resourceGroups.map((group, i) => (
          <div key={group.heading}>
            <CommandGroup heading={group.heading}>
              {group.items.map((item) => (
                <CommandItem
                  key={item.path}
                  onSelect={() => handleSelect(item.path)}
                  className="flex items-center gap-3 cursor-pointer"
                >
                  <item.icon className="h-4 w-4 text-muted-foreground" />
                  <span>{item.label}</span>
                </CommandItem>
              ))}
            </CommandGroup>
            {i < resourceGroups.length - 1 && <CommandSeparator />}
          </div>
        ))}
      </CommandList>
    </CmdDialog>
  );
}
