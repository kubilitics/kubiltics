import { useState } from "react";
import { useProjectStore } from "@/stores/projectStore";
import { useFinancialStackByProject } from "@/hooks/useAddOnCatalog";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Sparkles, ArrowRight, TrendingUp, ShieldCheck, DollarSign } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { motion, AnimatePresence } from "framer-motion";

export function FinancialStackPrompt() {
    const { activeProjectId } = useProjectStore();
    const { data: plan, isLoading } = useFinancialStackByProject(activeProjectId || "");
    const [dismissed, setDismissed] = useState(false);

    // If no project selected or already dismissed, show nothing
    if (!activeProjectId || dismissed) return null;

    if (isLoading) return <Skeleton className="h-24 w-full rounded-xl" />;

    // Only show if the plan recommends something (project-level recommendation)
    const suggested = plan?.suggested_addons;
    if (!plan || !suggested || suggested.length === 0) return null;

    return (
        <AnimatePresence>
            <motion.div
                initial={{ opacity: 0, y: -20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95 }}
            >
                <Card className="overflow-hidden border-blue-200 dark:border-blue-900 shadow-lg shadow-blue-500/5 bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-950/20 dark:to-indigo-950/20">
                    <CardContent className="p-0">
                        <div className="flex flex-col md:flex-row items-stretch">
                            <div className="bg-blue-600 p-6 flex items-center justify-center">
                                <Sparkles className="h-8 w-8 text-white animate-pulse" />
                            </div>

                            <div className="flex-1 p-6 flex flex-col md:flex-row gap-6 md:items-center justify-between">
                                <div className="space-y-2">
                                    <div className="flex items-center gap-2">
                                        <Badge className="bg-white/80 dark:bg-white/10 text-blue-700 dark:text-blue-300 border-blue-200 uppercase text-[10px] font-bold tracking-widest">Recommended</Badge>
                                        <h3 className="text-lg font-bold tracking-tight">Activate Financial Governance Stack</h3>
                                    </div>
                                    <p className="text-sm text-blue-800/70 dark:text-blue-200/60 max-w-xl">
                                        Get full visibility into cluster costs and performance. Includes <span className="font-bold">Prometheus</span>, <span className="font-bold">Grafana</span>, and <span className="font-bold">OpenCost</span> pre-configured for your project.
                                    </p>
                                    <div className="flex gap-4 mt-2">
                                        <div className="flex items-center gap-1.5 text-xs font-semibold text-blue-700 dark:text-blue-400">
                                            <TrendingUp className="h-3.5 w-3.5" /> Performance Data
                                        </div>
                                        <div className="flex items-center gap-1.5 text-xs font-semibold text-blue-700 dark:text-blue-400">
                                            <DollarSign className="h-3.5 w-3.5" /> Cost Attribution
                                        </div>
                                        <div className="flex items-center gap-1.5 text-xs font-semibold text-blue-700 dark:text-blue-400">
                                            <ShieldCheck className="h-3.5 w-3.5" /> Auto-Scaling Policy
                                        </div>
                                    </div>
                                </div>

                                <div className="flex items-center gap-3">
                                    <Button variant="ghost" size="sm" onClick={() => setDismissed(true)} className="text-blue-700 dark:text-blue-400">
                                        Maybe later
                                    </Button>
                                    <Button className="bg-blue-600 hover:bg-blue-700 text-white shadow-md shadow-blue-600/20 gap-2">
                                        Start Guided Setup <ArrowRight className="h-4 w-4" />
                                    </Button>
                                </div>
                            </div>
                        </div>
                    </CardContent>
                </Card>
            </motion.div>
        </AnimatePresence>
    );
}

function Badge({ children, className }: any) {
    return (
        <span className={`px-2 py-0.5 rounded-full border text-[10px] ${className}`}>
            {children}
        </span>
    );
}
