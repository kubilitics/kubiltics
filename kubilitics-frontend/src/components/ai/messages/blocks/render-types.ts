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

// Phase 2 #4: log-oriented render type. Brain's ShapeGetLogs caps lines
// at MaxLogLines (currently 500); when the source had more, `truncated`
// is true and `total` is the original line count so the UI can render
// "(earlier lines elided — showing last N of M)".
export type LogBlockData = {
  pod: string;
  container: string;
  namespace: string;
  lines: string[];
  truncated: boolean;
  total: number;
};
