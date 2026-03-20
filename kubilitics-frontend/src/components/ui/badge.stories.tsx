import type { Meta, StoryObj } from '@storybook/react';
import { Badge } from './badge';

const meta = {
  title: 'UI/Badge',
  component: Badge,
  parameters: {
    layout: 'centered',
  },
  tags: ['autodocs'],
  argTypes: {
    variant: {
      control: 'select',
      options: ['default', 'secondary', 'destructive', 'outline'],
      description: 'Visual style variant',
    },
    children: {
      control: 'text',
      description: 'Badge content',
    },
  },
} satisfies Meta<typeof Badge>;

export default meta;
type Story = StoryObj<typeof meta>;

// ─── Default ────────────────────────────────────────────────────────────────

export const Default: Story = {
  args: {
    children: 'Badge',
    variant: 'default',
  },
};

// ─── All Variants ───────────────────────────────────────────────────────────

export const AllVariants: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-3">
      <Badge variant="default">Default</Badge>
      <Badge variant="secondary">Secondary</Badge>
      <Badge variant="destructive">Destructive</Badge>
      <Badge variant="outline">Outline</Badge>
    </div>
  ),
};

// ─── Kubernetes Labels ──────────────────────────────────────────────────────

export const KubernetesLabels: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-2">
      <Badge variant="secondary">app=nginx</Badge>
      <Badge variant="secondary">env=production</Badge>
      <Badge variant="secondary">tier=frontend</Badge>
      <Badge variant="outline">version=v1.21.0</Badge>
    </div>
  ),
};

// ─── Namespace Tags ─────────────────────────────────────────────────────────

export const NamespaceTags: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-2">
      <Badge variant="default">default</Badge>
      <Badge variant="default">kube-system</Badge>
      <Badge variant="default">monitoring</Badge>
      <Badge variant="destructive">kube-public</Badge>
    </div>
  ),
};

// ─── Resource Counts ────────────────────────────────────────────────────────

export const ResourceCounts: Story = {
  render: () => (
    <div className="flex items-center gap-3">
      <div className="flex items-center gap-1.5">
        <span className="text-sm text-muted-foreground">Pods</span>
        <Badge variant="secondary">42</Badge>
      </div>
      <div className="flex items-center gap-1.5">
        <span className="text-sm text-muted-foreground">Services</span>
        <Badge variant="secondary">12</Badge>
      </div>
      <div className="flex items-center gap-1.5">
        <span className="text-sm text-muted-foreground">Errors</span>
        <Badge variant="destructive">3</Badge>
      </div>
    </div>
  ),
};

// ─── Inline with Text ───────────────────────────────────────────────────────

export const InlineWithText: Story = {
  render: () => (
    <div className="space-y-2 text-sm">
      <p>
        Deployment <Badge variant="outline">nginx-v2</Badge> is rolling out
      </p>
      <p>
        Node <Badge variant="secondary">worker-01</Badge> status: <Badge variant="default">Ready</Badge>
      </p>
      <p>
        <Badge variant="destructive">Critical</Badge> OOMKilled in namespace <Badge variant="outline">production</Badge>
      </p>
    </div>
  ),
};

// ─── Dark Mode ──────────────────────────────────────────────────────────────

export const DarkMode: Story = {
  render: () => (
    <div className="dark rounded-lg bg-background p-6">
      <div className="flex flex-wrap items-center gap-3">
        <Badge variant="default">Default</Badge>
        <Badge variant="secondary">Secondary</Badge>
        <Badge variant="destructive">Destructive</Badge>
        <Badge variant="outline">Outline</Badge>
      </div>
    </div>
  ),
  parameters: {
    backgrounds: { default: 'dark' },
  },
};

// ─── Truncated Long Text ────────────────────────────────────────────────────

export const LongText: Story = {
  render: () => (
    <div className="w-48">
      <Badge variant="secondary" className="max-w-full truncate">
        app.kubernetes.io/managed-by=helm
      </Badge>
    </div>
  ),
};

// ─── Custom Colors ──────────────────────────────────────────────────────────

export const CustomColors: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-3">
      <Badge className="border-emerald-200 bg-emerald-100 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
        Healthy
      </Badge>
      <Badge className="border-amber-200 bg-amber-100 text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300">
        Warning
      </Badge>
      <Badge className="border-blue-200 bg-blue-100 text-blue-800 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-300">
        Info
      </Badge>
      <Badge className="border-purple-200 bg-purple-100 text-purple-800 dark:border-purple-800 dark:bg-purple-950 dark:text-purple-300">
        Custom
      </Badge>
    </div>
  ),
};
