import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { RefreshCcw, Zap, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { motion } from 'framer-motion';

interface SectionOverviewHeaderProps {
    title: string;
    description: string;
    icon?: LucideIcon;
    onSync?: () => void;
    isSyncing?: boolean;
    showAiButton?: boolean;
    aiButtonText?: string;
    extraActions?: React.ReactNode;
}

export function SectionOverviewHeader({
    title,
    description,
    icon: Icon,
    onSync,
    isSyncing = false,
    showAiButton = true,
    aiButtonText = 'AI Recommendations',
    extraActions,
}: SectionOverviewHeaderProps) {
    return (
        <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, ease: 'easeOut' }}
            className="flex flex-col md:flex-row md:items-center justify-between gap-4"
        >
            <div className="flex items-start gap-4">
                {Icon && (
                    <div className="p-3 rounded-2xl bg-gradient-to-br from-primary/20 to-primary/5 text-primary shadow-sm border border-primary/10">
                        <Icon className="h-8 w-8" aria-hidden />
                    </div>
                )}
                <div>
                    <h1 className="text-3xl font-bold tracking-tight bg-gradient-to-r from-foreground to-foreground/70 bg-clip-text text-transparent">
                        {title}
                    </h1>
                    <p className="text-muted-foreground mt-1 flex items-center gap-2">
                        {description}
                        <Badge variant="secondary" className="bg-primary/10 text-primary border-primary/20 animate-in fade-in duration-500">
                            Live
                        </Badge>
                    </p>
                </div>
            </div>
            <div className="flex items-center gap-3">
                {extraActions}
                {onSync && (
                    <Button variant="outline" className="gap-2 h-10 px-4 transition-all hover:bg-muted" onClick={onSync} disabled={isSyncing}>
                        <RefreshCcw className={cn("h-4 w-4 transition-transform duration-500", isSyncing && "animate-spin")} />
                        {isSyncing ? 'Syncing...' : 'Sync'}
                    </Button>
                )}
                {showAiButton && (
                    <Button className="gap-2 h-10 px-5 bg-gradient-to-r from-primary to-blue-600 shadow-lg shadow-primary/20 hover:shadow-primary/40 transition-all active:scale-95">
                        <Zap className="h-4 w-4" />
                        {aiButtonText}
                    </Button>
                )}
            </div>
        </motion.div>
    );
}
