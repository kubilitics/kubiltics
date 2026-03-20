import type { Meta, StoryObj } from '@storybook/react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from './card';
import { Button } from './button';

const meta = {
  title: 'UI/Card',
  component: Card,
  parameters: {
    layout: 'centered',
  },
  tags: ['autodocs'],
  argTypes: {
    className: {
      control: 'text',
      description: 'Additional CSS classes',
    },
  },
} satisfies Meta<typeof Card>;

export default meta;
type Story = StoryObj<typeof meta>;

// ─── Default ────────────────────────────────────────────────────────────────

export const Default: Story = {
  render: (args) => (
    <Card {...args} className="w-[380px]">
      <CardHeader>
        <CardTitle>Deployment Status</CardTitle>
        <CardDescription>nginx-deployment in namespace default</CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">3/3 replicas running. Last updated 2 minutes ago.</p>
      </CardContent>
      <CardFooter className="justify-between">
        <Button variant="outline" size="sm">View Logs</Button>
        <Button size="sm">Scale</Button>
      </CardFooter>
    </Card>
  ),
};

// ─── Header Only ────────────────────────────────────────────────────────────

export const HeaderOnly: Story = {
  render: () => (
    <Card className="w-[380px]">
      <CardHeader>
        <CardTitle>Cluster Overview</CardTitle>
        <CardDescription>Production cluster health summary</CardDescription>
      </CardHeader>
    </Card>
  ),
};

// ─── Content Only ───────────────────────────────────────────────────────────

export const ContentOnly: Story = {
  render: () => (
    <Card className="w-[380px]">
      <CardContent className="pt-6">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">CPU Usage</span>
          <span className="text-2xl font-bold">72%</span>
        </div>
        <div className="mt-2 h-2 w-full rounded-full bg-secondary">
          <div className="h-2 rounded-full bg-primary" style={{ width: '72%' }} />
        </div>
      </CardContent>
    </Card>
  ),
};

// ─── With Footer Actions ────────────────────────────────────────────────────

export const WithFooterActions: Story = {
  render: () => (
    <Card className="w-[380px]">
      <CardHeader>
        <CardTitle>Delete Pod</CardTitle>
        <CardDescription>This action cannot be undone.</CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">
          Are you sure you want to delete pod <code className="rounded bg-muted px-1 py-0.5 text-xs font-mono">nginx-abc123</code>?
        </p>
      </CardContent>
      <CardFooter className="justify-end gap-2">
        <Button variant="outline" size="sm">Cancel</Button>
        <Button variant="destructive" size="sm">Delete</Button>
      </CardFooter>
    </Card>
  ),
};

// ─── Stacked Cards ──────────────────────────────────────────────────────────

export const StackedCards: Story = {
  render: () => (
    <div className="flex flex-col gap-4 w-[380px]">
      {(['Nodes', 'Pods', 'Services'] as const).map((resource) => (
        <Card key={resource}>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">{resource}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">
              {resource === 'Nodes' ? 5 : resource === 'Pods' ? 42 : 12}
            </p>
            <p className="text-xs text-muted-foreground">All healthy</p>
          </CardContent>
        </Card>
      ))}
    </div>
  ),
};

// ─── Grid Layout ────────────────────────────────────────────────────────────

export const GridLayout: Story = {
  render: () => (
    <div className="grid grid-cols-2 gap-4 w-[500px]">
      {[
        { title: 'CPU', value: '45%', color: 'text-emerald-600' },
        { title: 'Memory', value: '68%', color: 'text-amber-600' },
        { title: 'Disk', value: '23%', color: 'text-blue-600' },
        { title: 'Network', value: '12 MB/s', color: 'text-purple-600' },
      ].map((metric) => (
        <Card key={metric.title}>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">{metric.title}</p>
            <p className={`text-2xl font-bold ${metric.color}`}>{metric.value}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  ),
};

// ─── Dark Mode ──────────────────────────────────────────────────────────────

export const DarkMode: Story = {
  render: () => (
    <div className="dark rounded-lg bg-background p-6">
      <Card className="w-[380px]">
        <CardHeader>
          <CardTitle>Pod Metrics</CardTitle>
          <CardDescription>Real-time resource utilization</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">CPU</span>
              <span className="font-medium">250m / 500m</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Memory</span>
              <span className="font-medium">128Mi / 256Mi</span>
            </div>
          </div>
        </CardContent>
        <CardFooter>
          <Button variant="outline" size="sm" className="w-full">View Details</Button>
        </CardFooter>
      </Card>
    </div>
  ),
  parameters: {
    backgrounds: { default: 'dark' },
  },
};

// ─── Custom Styled ──────────────────────────────────────────────────────────

export const CustomStyled: Story = {
  render: () => (
    <Card className="w-[380px] border-emerald-200 bg-emerald-50/50 dark:border-emerald-800 dark:bg-emerald-950/20">
      <CardHeader>
        <CardTitle className="text-emerald-900 dark:text-emerald-100">Cluster Healthy</CardTitle>
        <CardDescription className="text-emerald-700 dark:text-emerald-400">
          All systems operational
        </CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-emerald-600 dark:text-emerald-300">
          5 nodes, 42 pods, 0 alerts
        </p>
      </CardContent>
    </Card>
  ),
};
