import { Info } from 'lucide-react';

interface Props {
  message: string;
}

export function SystemNotice({ message }: Props) {
  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground my-2 px-3 py-1.5 bg-muted/30 rounded">
      <Info className="h-3.5 w-3.5" />
      <span>{message}</span>
    </div>
  );
}
