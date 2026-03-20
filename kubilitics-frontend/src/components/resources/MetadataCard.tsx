import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

export interface MetadataCardProps {
  title: string;
  items: Record<string, string>;
  variant?: 'default' | 'badges';
}

export function MetadataCard({ title, items, variant = 'default' }: MetadataCardProps) {
  const entries = Object.entries(items);
  
  if (entries.length === 0) {
    return null;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {variant === 'badges' ? (
          <div className="flex flex-wrap gap-2">
            {entries.map(([key, value]) => (
              <Badge key={key} variant="secondary" className="font-mono text-xs">
                {key}: {value}
              </Badge>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4 text-sm">
            {entries.map(([key, value]) => (
              <div key={key}>
                <p className="text-muted-foreground mb-1">{key}</p>
                <p className="font-mono">{value}</p>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
