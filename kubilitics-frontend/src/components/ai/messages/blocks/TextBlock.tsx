import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cn } from '@/lib/utils';

interface Props {
  content: string;
  complete: boolean;
}

/**
 * Renders one TextBlock from an AssistantTurn. Markdown + GFM (tables,
 * task lists, strikethrough). While !complete, shows a blinking cursor at
 * the end of the rendered content.
 */
export function TextBlock({ content, complete }: Props) {
  return (
    <div className={cn('text-sm leading-relaxed prose prose-sm max-w-none dark:prose-invert')}>
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
      {!complete && (
        <span
          data-streaming-cursor="true"
          className="inline-block w-1.5 h-4 ml-0.5 bg-current align-text-bottom animate-pulse"
        />
      )}
    </div>
  );
}
