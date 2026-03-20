import type { Meta, StoryObj } from '@storybook/react';
import { fn } from '@storybook/test';
import { Mail, Loader2, ChevronRight, Plus, Trash2 } from 'lucide-react';
import { Button } from './button';

const meta = {
  title: 'UI/Button',
  component: Button,
  parameters: {
    layout: 'centered',
  },
  tags: ['autodocs'],
  argTypes: {
    variant: {
      control: 'select',
      options: ['default', 'destructive', 'outline', 'secondary', 'ghost', 'link'],
      description: 'Visual style variant',
    },
    size: {
      control: 'select',
      options: ['default', 'sm', 'lg', 'icon'],
      description: 'Size variant',
    },
    disabled: {
      control: 'boolean',
      description: 'Disabled state',
    },
    asChild: {
      control: 'boolean',
      description: 'Render as child element via Radix Slot',
    },
  },
  args: {
    onClick: fn(),
  },
} satisfies Meta<typeof Button>;

export default meta;
type Story = StoryObj<typeof meta>;

// ─── Default ────────────────────────────────────────────────────────────────

export const Default: Story = {
  args: {
    children: 'Button',
    variant: 'default',
    size: 'default',
  },
};

// ─── All Variants ───────────────────────────────────────────────────────────

export const AllVariants: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-4">
      <Button variant="default">Default</Button>
      <Button variant="secondary">Secondary</Button>
      <Button variant="destructive">Destructive</Button>
      <Button variant="outline">Outline</Button>
      <Button variant="ghost">Ghost</Button>
      <Button variant="link">Link</Button>
    </div>
  ),
};

// ─── All Sizes ──────────────────────────────────────────────────────────────

export const AllSizes: Story = {
  render: () => (
    <div className="flex items-center gap-4">
      <Button size="sm">Small</Button>
      <Button size="default">Default</Button>
      <Button size="lg">Large</Button>
      <Button size="icon">
        <Plus className="h-4 w-4" />
      </Button>
    </div>
  ),
};

// ─── With Icon ──────────────────────────────────────────────────────────────

export const WithIcon: Story = {
  args: {
    children: (
      <>
        <Mail /> Send Email
      </>
    ),
    variant: 'default',
  },
};

export const IconRight: Story = {
  args: {
    children: (
      <>
        Next <ChevronRight />
      </>
    ),
    variant: 'outline',
  },
};

// ─── Loading State ──────────────────────────────────────────────────────────

export const Loading: Story = {
  args: {
    disabled: true,
    children: (
      <>
        <Loader2 className="animate-spin" /> Deploying...
      </>
    ),
    variant: 'default',
  },
};

// ─── Disabled ───────────────────────────────────────────────────────────────

export const Disabled: Story = {
  render: () => (
    <div className="flex items-center gap-4">
      <Button disabled variant="default">Default</Button>
      <Button disabled variant="secondary">Secondary</Button>
      <Button disabled variant="destructive">Destructive</Button>
      <Button disabled variant="outline">Outline</Button>
    </div>
  ),
};

// ─── Destructive with Icon ──────────────────────────────────────────────────

export const DestructiveWithIcon: Story = {
  args: {
    variant: 'destructive',
    children: (
      <>
        <Trash2 /> Delete Pod
      </>
    ),
  },
};

// ─── Dark Mode ──────────────────────────────────────────────────────────────

export const DarkMode: Story = {
  render: () => (
    <div className="dark rounded-lg bg-background p-6">
      <div className="flex flex-wrap items-center gap-4">
        <Button variant="default">Default</Button>
        <Button variant="secondary">Secondary</Button>
        <Button variant="destructive">Destructive</Button>
        <Button variant="outline">Outline</Button>
        <Button variant="ghost">Ghost</Button>
        <Button variant="link">Link</Button>
      </div>
    </div>
  ),
  parameters: {
    backgrounds: { default: 'dark' },
  },
};

// ─── Full Width ─────────────────────────────────────────────────────────────

export const FullWidth: Story = {
  args: {
    children: 'Deploy to Cluster',
    className: 'w-full',
  },
  decorators: [
    (Story) => (
      <div className="w-80">
        <Story />
      </div>
    ),
  ],
};
