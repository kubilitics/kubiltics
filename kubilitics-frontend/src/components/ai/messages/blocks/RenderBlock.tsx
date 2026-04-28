import type { KubectlTableData, YamlBlockData, LogBlockData, RenderErrorData } from './render-types';
import { KubectlTableBlock } from './KubectlTableBlock';
import { YamlBlock } from './YamlBlock';
import { LogBlock } from './LogBlock';
import { RenderErrorBlock } from './RenderErrorBlock';

interface Props {
  renderType: string;
  data: unknown;
  summary?: string;
}

export function RenderBlock({ renderType, data, summary }: Props) {
  return (
    <div className="render-block space-y-2 my-2">
      {summary && (
        <div className="text-muted-foreground text-sm" data-testid="render-summary">
          {summary}
        </div>
      )}
      {dispatch(renderType, data)}
    </div>
  );
}

function dispatch(renderType: string, data: unknown) {
  switch (renderType) {
    case 'kubectl_table':
      return <KubectlTableBlock data={data as KubectlTableData} />;
    case 'yaml_block':
      return <YamlBlock data={data as YamlBlockData} />;
    case 'log_block':
      return <LogBlock data={data as LogBlockData} />;
    case 'render_error':
      return <RenderErrorBlock data={data as RenderErrorData} />;
    default:
      // Forward-compat: future render types render as RenderError so
      // they're never silently dropped.
      return (
        <RenderErrorBlock
          data={{
            tool: 'unknown',
            error: `Unknown render type: ${renderType}`,
            raw: data,
          }}
        />
      );
  }
}
