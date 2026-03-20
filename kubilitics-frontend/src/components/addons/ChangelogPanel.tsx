import { VersionChangelog } from "@/types/api/addons";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { History, CheckCircle2, AlertCircle, ExternalLink } from "lucide-react";
import { Separator } from "@/components/ui/separator";

interface ChangelogPanelProps {
    versions: VersionChangelog[];
}

export function ChangelogPanel({ versions }: ChangelogPanelProps) {
    if (!versions || versions.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center py-12 text-center text-muted-foreground">
                <History className="h-12 w-12 mb-4 opacity-20" />
                <p>No version history available for this add-on.</p>
            </div>
        );
    }

    return (
        <div className="flex flex-col gap-6">
            {versions.map((v, idx) => (
                <Card key={v.version} className={idx === 0 ? "border-primary/20 bg-primary/5" : ""}>
                    <CardHeader className="pb-3">
                        <div className="flex justify-between items-start">
                            <div className="flex flex-col gap-1">
                                <div className="flex items-center gap-2">
                                    <CardTitle className="text-xl">v{v.version}</CardTitle>
                                    {idx === 0 && <Badge>Latest</Badge>}
                                </div>
                                <p className="text-xs text-muted-foreground">{v.release_date}</p>
                            </div>
                            {v.changelog_url && (
                                <Button variant="ghost" size="sm" asChild className="h-8">
                                    <a href={v.changelog_url} target="_blank" rel="noreferrer" className="gap-1">
                                        Release Notes <ExternalLink className="h-3 w-3" />
                                    </a>
                                </Button>
                            )}
                        </div>
                    </CardHeader>
                    <CardContent className="flex flex-col gap-4">
                        {v.highlights && v.highlights.length > 0 && (
                            <div className="space-y-2">
                                <h4 className="text-sm font-semibold flex items-center gap-2">
                                    <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                                    Highlights
                                </h4>
                                <ul className="list-disc list-inside text-sm text-muted-foreground pl-1 space-y-1">
                                    {v.highlights.map((h, i) => (
                                        <li key={i}>{h}</li>
                                    ))}
                                </ul>
                            </div>
                        )}

                        {v.breaking_changes && v.breaking_changes.length > 0 && (
                            <div className="space-y-2 p-3 rounded-lg bg-orange-50 dark:bg-orange-900/10 border border-orange-100 dark:border-orange-900/20">
                                <h4 className="text-sm font-semibold flex items-center gap-2 text-orange-700 dark:text-orange-400">
                                    <AlertCircle className="h-4 w-4" />
                                    Breaking Changes
                                </h4>
                                <ul className="list-disc list-inside text-sm text-orange-700/80 dark:text-orange-400/80 pl-1 space-y-1">
                                    {v.breaking_changes.map((b, i) => (
                                        <li key={i}>{b}</li>
                                    ))}
                                </ul>
                            </div>
                        )}
                    </CardContent>
                </Card>
            ))}
        </div>
    );
}

// Minimal Button component if not imported from UI
function Button({ className, variant, size, asChild, ...props }: any) {
    const Component = asChild ? 'span' : 'button';
    return <Component className={className} {...props} />;
}
