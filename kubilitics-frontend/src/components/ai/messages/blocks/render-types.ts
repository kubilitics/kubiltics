// Wire types for the render_block payload that flows brain → backend → WS
// → chatStore → RenderBlock dispatcher. The brain's shaper owns the
// `data` shape; the frontend renders it byte-equal without ever asking
// the LLM what the data means.

export type KubectlTableData = {
  columns: Array<{ key: string; label: string; align?: 'left' | 'right' }>;
  rows: Array<Record<string, string | number>>;
};

export type YamlBlockData = { yaml: string };

export type RenderErrorData = {
  tool: string;
  error: string;
  raw: unknown;
};
