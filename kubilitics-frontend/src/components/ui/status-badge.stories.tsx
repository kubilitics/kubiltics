import type { Meta, StoryObj } from '@storybook/react';
import { Shield } from 'lucide-react';
import {
  StatusBadge,
  K8sStatusBadge,
  type StatusBadgeVariant,
  type StatusType,
} from './status-badge';

// ─── StatusBadge (variant-based API) ────────────────────────────────────────

const meta = {
  title: 'UI/StatusBadge',
  component: StatusBadge,
  parameters: {
    layout: 'centered',
  },
  tags: ['autodocs'],
  argTypes: {
    variant: {
      control: 'select',
      options: ['success', 'warning', 'error', 'info', 'neutral', 'loading'] satisfies StatusBadgeVariant[],
      description: 'Color and icon variant',
    },
    label: {
      control: 'text',
      description: 'Display label text',
    },
    size: {
      control: 'select',
      options: ['sm', 'default', 'lg'],
      description: 'Badge size',
    },
    dot: {
      control: 'boolean',
      description: 'Show pulsing dot instead of icon',
    },
    iconOnly: {
      control: 'boolean',
      description: 'Show icon only (no label)',
    },
  },
} satisfies Meta<typeof StatusBadge>;

export default meta;
type Story = StoryObj<typeof meta>;

// ─── Default ────────────────────────────────────────────────────────────────

export const Default: Story = {
  args: {
    variant: 'success',
    label: 'Running',
    size: 'default',
    dot: false,
    iconOnly: false,
  },
};

// ─── All Variants ───────────────────────────────────────────────────────────

export const AllVariants: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-3">
      <StatusBadge variant="success" label="Healthy" />
      <StatusBadge variant="warning" label="Pending" />
      <StatusBadge variant="error" label="Failed" />
      <StatusBadge variant="info" label="Syncing" />
      <StatusBadge variant="neutral" label="Unknown" />
      <StatusBadge variant="loading" label="Loading" />
    </div>
  ),
};

// ─── All Sizes ──────────────────────────────────────────────────────────────

export const AllSizes: Story = {
  render: () => (
    <div className="flex items-center gap-3">
      <StatusBadge variant="success" label="Small" size="sm" />
      <StatusBadge variant="success" label="Default" size="default" />
      <StatusBadge variant="success" label="Large" size="lg" />
    </div>
  ),
};

// ─── Dot Mode ───────────────────────────────────────────────────────────────

export const DotMode: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-3">
      <StatusBadge variant="success" label="Active" dot />
      <StatusBadge variant="warning" label="Degraded" dot />
      <StatusBadge variant="error" label="Down" dot />
      <StatusBadge variant="info" label="Syncing" dot />
      <StatusBadge variant="loading" label="Connecting" dot />
    </div>
  ),
};

// ─── Icon Only Mode ─────────────────────────────────────────────────────────

export const IconOnly: Story = {
  render: () => (
    <div className="flex items-center gap-4">
      <StatusBadge variant="success" label="Healthy" iconOnly />
      <StatusBadge variant="warning" label="Warning" iconOnly />
      <StatusBadge variant="error" label="Error" iconOnly />
      <StatusBadge variant="info" label="Info" iconOnly />
      <StatusBadge variant="neutral" label="Unknown" iconOnly />
      <StatusBadge variant="loading" label="Loading" iconOnly />
    </div>
  ),
};

// ─── Custom Icon ────────────────────────────────────────────────────────────

export const CustomIcon: Story = {
  args: {
    variant: 'info',
    label: 'Protected',
    icon: Shield,
  },
};

// ─── Dark Mode ──────────────────────────────────────────────────────────────

export const DarkMode: Story = {
  render: () => (
    <div className="dark rounded-lg bg-background p-6">
      <div className="flex flex-wrap items-center gap-3">
        <StatusBadge variant="success" label="Healthy" />
        <StatusBadge variant="warning" label="Pending" />
        <StatusBadge variant="error" label="Failed" />
        <StatusBadge variant="info" label="Syncing" />
        <StatusBadge variant="neutral" label="Unknown" />
        <StatusBadge variant="loading" label="Loading" />
      </div>
    </div>
  ),
  parameters: {
    backgrounds: { default: 'dark' },
  },
};

// ─── K8sStatusBadge Stories ─────────────────────────────────────────────────

const k8sMeta = {
  title: 'UI/K8sStatusBadge',
  component: K8sStatusBadge,
  parameters: {
    layout: 'centered',
  },
  tags: ['autodocs'],
  argTypes: {
    status: {
      control: 'select',
      options: [
        'healthy', 'running', 'ready', 'succeeded', 'active', 'bound',
        'available', 'completed', 'warning', 'pending', 'error', 'failed',
        'crashloopbackoff', 'imagepullbackoff', 'terminated', 'evicted',
        'unknown', 'loading', 'stopped', 'paused', 'protected',
      ] satisfies StatusType[],
      description: 'Kubernetes status string',
    },
    size: {
      control: 'select',
      options: ['sm', 'default', 'lg'],
    },
    dot: { control: 'boolean' },
    iconOnly: { control: 'boolean' },
    pulse: { control: 'boolean' },
  },
} satisfies Meta<typeof K8sStatusBadge>;

// We export these as named stories within the same file since K8sStatusBadge
// is co-located in the same source module.

export const K8sDefault: StoryObj<typeof k8sMeta> = {
  render: (args) => <K8sStatusBadge {...args} />,
  args: {
    status: 'running',
    size: 'default',
  },
};

export const K8sAllStatuses: StoryObj<typeof k8sMeta> = {
  render: () => {
    const statuses: StatusType[] = [
      'healthy', 'running', 'ready', 'succeeded', 'active', 'bound',
      'available', 'completed', 'warning', 'pending', 'error', 'failed',
      'crashloopbackoff', 'imagepullbackoff', 'terminated', 'evicted',
      'unknown', 'loading', 'stopped', 'paused', 'protected',
    ];
    return (
      <div className="flex flex-wrap items-center gap-3">
        {statuses.map((status) => (
          <K8sStatusBadge key={status} status={status} />
        ))}
      </div>
    );
  },
};

export const K8sWithDots: StoryObj<typeof k8sMeta> = {
  render: () => (
    <div className="flex flex-wrap items-center gap-3">
      <K8sStatusBadge status="running" dot />
      <K8sStatusBadge status="pending" dot />
      <K8sStatusBadge status="failed" dot />
      <K8sStatusBadge status="loading" pulse />
    </div>
  ),
};

export const K8sSizes: StoryObj<typeof k8sMeta> = {
  render: () => (
    <div className="flex items-center gap-3">
      <K8sStatusBadge status="running" size="sm" />
      <K8sStatusBadge status="running" size="default" />
      <K8sStatusBadge status="running" size="lg" />
    </div>
  ),
};
