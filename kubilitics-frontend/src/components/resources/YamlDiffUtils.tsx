import { cn } from '@/lib/utils';

export interface YamlVersion {
    id: string;
    label: string;
    yaml: string;
    timestamp?: string;
}

export interface DiffLine {
    type: 'added' | 'removed' | 'unchanged' | 'modified-added' | 'modified-removed' | 'modified';
    lineNumber: { left?: number; right?: number };
    content: { left?: string; right?: string };
    segments?: Array<{ text: string; highlight?: boolean }>;
}

export function computeDiff(leftYaml: string, rightYaml: string): DiffLine[] {
    const leftLines = leftYaml.split('\n');
    const rightLines = rightYaml.split('\n');
    const result: DiffLine[] = [];

    const m = leftLines.length;
    const n = rightLines.length;

    const dp: number[][] = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));

    for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
            if (leftLines[i - 1] === rightLines[j - 1]) {
                dp[i][j] = dp[i - 1][j - 1] + 1;
            } else {
                dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
            }
        }
    }

    let i = m, j = n;
    const diffReverse: DiffLine[] = [];

    while (i > 0 || j > 0) {
        if (i > 0 && j > 0 && leftLines[i - 1] === rightLines[j - 1]) {
            diffReverse.push({
                type: 'unchanged',
                lineNumber: { left: i, right: j },
                content: { left: leftLines[i - 1], right: rightLines[j - 1] }
            });
            i--;
            j--;
        } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
            diffReverse.push({
                type: 'added',
                lineNumber: { right: j },
                content: { right: rightLines[j - 1] }
            });
            j--;
        } else {
            diffReverse.push({
                type: 'removed',
                lineNumber: { left: i },
                content: { left: leftLines[i - 1] }
            });
            i--;
        }
    }

    return diffReverse.reverse();
}

/** 
 * Renders a YAML line with syntax coloring and optional intra-line highlight regions.
 */
export function YamlLineContent({ line, segments }: { line: string; segments?: Array<{ text: string; highlight?: boolean }> }) {
    if (!line && (!segments || segments.length === 0)) return <span className="inline-block min-h-[1em]"> </span>;

    if (segments && segments.length > 0) {
        return (
            <>
                {segments.map((s, i) => (
                    <span
                        key={i}
                        className={cn(
                            s.highlight && "bg-red-500/40 dark:bg-red-500/50 rounded-sm px-0.5 font-bold shadow-[0_0_0_1px_rgba(239,68,68,0.3)]",
                            !s.highlight && "opacity-90"
                        )}
                    >
                        {s.text}
                    </span>
                ))}
            </>
        );
    }

    const trimmed = line.trimStart();
    const indent = line.slice(0, line.length - trimmed.length);
    const colonIdx = trimmed.indexOf(':');
    if (colonIdx === -1) {
        return <><span className="text-muted-foreground/80">{indent}</span><span>{trimmed}</span></>;
    }
    const keyPart = trimmed.slice(0, colonIdx + 1);
    const valuePart = trimmed.slice(colonIdx + 1).trimStart();
    const isQuoted = /^['"]|['"]$/.test(valuePart);
    const isNumber = /^-?\d+(\.\d+)?$/.test(valuePart) || valuePart === 'true' || valuePart === 'false';
    return (
        <>
            <span className="text-muted-foreground/80">{indent}</span>
            <span className="text-blue-600 dark:text-blue-400">{keyPart}</span>
            {valuePart && (
                <span className={cn(
                    isQuoted && 'text-emerald-600 dark:text-emerald-400',
                    isNumber && !isQuoted && 'text-amber-600 dark:text-amber-400',
                    'ml-1'
                )}>
                    {valuePart}
                </span>
            )}
        </>
    );
}

/** Simple word-level diff for intra-line highlighting */
export function getIntraLineDiff(oldStr: string, newStr: string) {
    const oldWords = oldStr.split(/(\s+|[:\-,[\]{}])/);
    const newWords = newStr.split(/(\s+|[:\-,[\]{}])/);
    const leftSegments: Array<{ text: string; highlight?: boolean }> = [];
    const rightSegments: Array<{ text: string; highlight?: boolean }> = [];

    const maxLen = Math.max(oldWords.length, newWords.length);
    for (let i = 0; i < maxLen; i++) {
        const ow = oldWords[i] || '';
        const nw = newWords[i] || '';
        if (ow === nw) {
            leftSegments.push({ text: ow });
            rightSegments.push({ text: nw });
        } else {
            if (ow) leftSegments.push({ text: ow, highlight: true });
            if (nw) rightSegments.push({ text: nw, highlight: true });
        }
    }

    return { leftSegments, rightSegments };
}
