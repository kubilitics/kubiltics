import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { RefreshCcw, Zap, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { motion } from 'framer-motion';

interface SectionOverviewHeaderProps {
    title: string;
    description: string;
    icon?: LucideIcon;
    /** Custom class for the icon well gradient + text color. Defaults to primary blue. */
    iconClassName?: string;
    onSync?: () => void;
    isSyncing?: boolean;
    showAiButton?: boolean;
    aiButtonText?: string;
    extraActions?: React.ReactNode;
    /**
     * Render the decorative "Live" pill next to the description.
     * Default true for backward compatibility with the 25+ pages that
     * already rely on it. Set to false on pages where nothing actually
     * streams (e.g. AI Settings, static config pages) — decorative
     * liveness is UX theater when the underlying data isn't live.
     */
    liveBadge?: boolean;
}

export function SectionOverviewHeader({
    title,
    description,
    icon: Icon,
    iconClassName,
    onSync,
    isSyncing = false,
    showAiButton = false,
    aiButtonText = 'AI Recommendations',
    extraActions,
    liveBadge = true,
}: SectionOverviewHeaderProps) {
    return (
        <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, ease: 'easeOut' }}
            className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-border/40"
        >
            <div className="flex items-start gap-4">
                {Icon && (
                    <motion.div
                        initial={{ scale: 0.8, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        transition={{ type: 'spring', stiffness: 300, damping: 20, delay: 0.1 }}
                        className={cn("p-3 rounded-2xl bg-gradient-to-br shadow-sm border transition-colors duration-200", iconClassName ? iconClassName : "from-primary/20 to-primary/5 text-primary border-primary/10")}
                    >
                        <Icon className="h-8 w-8" aria-hidden />
                    </motion.div>
                )}
                <div>
                    <motion.h1
                        initial={{ opacity: 0, x: -8 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1], delay: 0.12 }}
                        className="text-3xl font-bold tracking-tight bg-gradient-to-r from-foreground to-foreground/70 bg-clip-text text-transparent"
                    >
                        {title}
                    </motion.h1>
                    <motion.p
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ duration: 0.35, delay: 0.22 }}
                        className="text-muted-foreground mt-1 flex items-center gap-2"
                    >
                        {description}
                        {liveBadge && (
                            <Badge variant="secondary" className="bg-primary/10 text-primary border-primary/20 animate-in fade-in duration-500">
                                <span className="relative flex h-1.5 w-1.5 mr-1.5">
                                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[hsl(var(--success))] opacity-60" />
                                    <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-[hsl(var(--success))]" />
                                </span>
                                Live
                            </Badge>
                        )}
                    </motion.p>
                </div>
            </div>
            <motion.div
                initial={{ opacity: 0, x: 8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.35, delay: 0.25 }}
                className="flex items-center gap-3"
            >
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
            </motion.div>
        </motion.div>
    );
}
