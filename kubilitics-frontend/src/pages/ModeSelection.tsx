import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, type Variants } from 'framer-motion';
import {
    Monitor,
    Cloud,
    ArrowRight,
    Zap,
    Shield,
    BarChart3,
    CheckCircle2,
    Info,
    Sparkles,
} from 'lucide-react';
import { BrandLogo } from '@/components/BrandLogo';
import { Button } from '@/components/ui/button';
import { useClusterStore } from '@/stores/clusterStore';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

const container: Variants = {
    hidden: { opacity: 0 },
    show: {
        opacity: 1,
        transition: {
            staggerChildren: 0.1,
            delayChildren: 0.15,
        },
    },
};

const item: Variants = {
    hidden: { opacity: 0, y: 24 },
    show: { opacity: 1, y: 0, transition: { duration: 0.7, ease: [0.16, 1, 0.3, 1] } },
};

export default function ModeSelection() {
    const navigate = useNavigate();
    const setAppMode = useClusterStore((s) => s.setAppMode);
    const [showComparison, setShowComparison] = useState(false);
    const [hoveredCard, setHoveredCard] = useState<'desktop' | 'cluster' | null>(null);

    const handleSelectMode = (mode: 'desktop' | 'in-cluster') => {
        setAppMode(mode);
        navigate('/connect');
    };

    return (
        <div className="relative min-h-screen bg-gradient-to-b from-slate-50 via-white to-blue-50/30 dark:from-[hsl(228,14%,7%)] dark:via-[hsl(228,14%,9%)] dark:to-[hsl(228,14%,11%)] text-foreground overflow-hidden flex flex-col items-center justify-center px-6 py-4 md:px-8 md:py-6">
            {/* Ambient light orbs */}
            <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden="true">
                <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] bg-blue-200/20 dark:bg-blue-900/20 rounded-full blur-[120px]" />
                <div className="absolute bottom-[-20%] right-[-10%] w-[50%] h-[50%] bg-indigo-200/20 dark:bg-indigo-900/20 rounded-full blur-[120px]" />
                <div className="absolute top-[30%] right-[10%] w-[25%] h-[30%] bg-purple-100/15 dark:bg-purple-900/15 rounded-full blur-[100px]" />
                {/* Grid pattern */}
                <div className="absolute inset-0 opacity-[0.02] dark:opacity-[0.04]" style={{
                    backgroundImage: 'radial-gradient(circle, #64748b 1px, transparent 1px)',
                    backgroundSize: '32px 32px',
                }} />
            </div>

            <motion.div
                variants={container}
                initial="hidden"
                animate="show"
                className="relative z-10 w-full max-w-5xl"
            >
                {/* Hero */}
                <motion.div variants={item} className="text-center mb-8 md:mb-10">
                    <div className="flex flex-col items-center justify-center gap-3 mb-5">
                        <motion.div
                            className="relative group"
                            whileHover={{ scale: 1.05 }}
                            transition={{ type: 'spring', stiffness: 300, damping: 20 }}
                        >
                            <div className="absolute inset-0 bg-blue-400/20 blur-3xl rounded-full scale-75 group-hover:scale-150 transition-transform duration-1000 opacity-0 group-hover:opacity-100" />
                            <BrandLogo
                                height={80}
                                className="relative drop-shadow-lg"
                            />
                        </motion.div>
                    </div>

                    <h1 className="text-3xl md:text-4xl font-bold mb-2.5 tracking-[-0.03em] leading-[1.1] text-slate-900 dark:text-slate-100">
                        How will you connect?
                    </h1>
                    <p className="text-sm md:text-base text-slate-500 dark:text-slate-400 max-w-xl mx-auto leading-relaxed font-medium">
                        The Kubernetes Operating System. Choose Personal for local use, or Team Server to deploy for your organization.
                    </p>
                    <p className="text-xs text-slate-400 dark:text-slate-500 mt-2 font-medium">
                        Not sure? Choose Personal — you can switch anytime in Settings.
                    </p>
                </motion.div>

                {/* Mode Cards */}
                <div className="grid md:grid-cols-2 gap-5 md:gap-6 mb-8 md:mb-10">
                    {/* Personal (Desktop) */}
                    <motion.div variants={item} className="h-full">
                        <div
                            onClick={() => handleSelectMode('desktop')}
                            onMouseEnter={() => setHoveredCard('desktop')}
                            onMouseLeave={() => setHoveredCard(null)}
                            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleSelectMode('desktop'); } }}
                            role="button"
                            tabIndex={0}
                            aria-label="Launch Personal desktop mode — runs locally on your machine"
                            className={cn(
                                "group relative h-full bg-white dark:bg-[hsl(228,14%,11%)] border border-slate-200/80 dark:border-slate-700/60 cursor-pointer overflow-hidden p-6 md:p-7 rounded-2xl transition-all duration-500",
                                "hover:border-blue-300/60 dark:hover:border-blue-500/40 hover:-translate-y-1",
                                "focus-visible:ring-2 focus-visible:ring-blue-500/50 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-[hsl(228,14%,7%)]",
                                hoveredCard === 'desktop' ? 'shadow-[0_16px_48px_-12px_rgba(59,130,246,0.15)] dark:shadow-[0_16px_48px_-12px_rgba(59,130,246,0.25)]' : 'shadow-[0_4px_24px_-4px_rgba(0,0,0,0.06)] dark:shadow-[0_4px_24px_-4px_rgba(0,0,0,0.3)]',
                            )}
                        >
                            {/* Hover gradient */}
                            <div className="absolute inset-0 bg-gradient-to-br from-blue-50/80 via-transparent to-indigo-50/40 dark:from-blue-950/30 dark:via-transparent dark:to-indigo-950/20 opacity-0 group-hover:opacity-100 transition-opacity duration-700" aria-hidden="true" />

                            <div className="relative z-10 h-full flex flex-col">
                                <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center mb-4 shadow-lg shadow-blue-500/20 group-hover:scale-110 group-hover:shadow-xl group-hover:shadow-blue-500/30 transition-all duration-500 ease-spring">
                                    <Monitor className="text-white" size={22} />
                                </div>

                                <h3 className="text-xl md:text-2xl font-bold mb-1 tracking-tight text-slate-900 dark:text-slate-100">
                                    Personal
                                </h3>
                                <p className="text-xs font-semibold uppercase tracking-widest text-blue-500 dark:text-blue-400 mb-3">Runs locally on your machine</p>
                                <p className="text-slate-500 dark:text-slate-400 mb-5 leading-relaxed text-[13px] font-medium">
                                    Auto-detects your kubeconfig, connects to your clusters, and runs entirely on your machine. No server deployment required.
                                </p>

                                <ul className="space-y-2.5 mb-6 flex-grow">
                                    {[
                                        'Auto-detect kubeconfig & contexts',
                                        'Works offline — no internet required',
                                        'Private — data stays on your machine',
                                        'Instant startup — no deployment needed',
                                    ].map((feature) => (
                                        <li key={feature} className="flex items-center gap-2.5 text-[13px] text-slate-600 dark:text-slate-400 font-medium">
                                            <div className="flex-shrink-0 w-4.5 h-4.5 rounded-full bg-blue-100 dark:bg-blue-900/40 flex items-center justify-center">
                                                <CheckCircle2 size={11} className="text-blue-600 dark:text-blue-400" />
                                            </div>
                                            {feature}
                                        </li>
                                    ))}
                                </ul>

                                <Button className="w-full bg-blue-600 hover:bg-blue-700 text-white rounded-xl h-11 text-sm font-semibold transition-all duration-300 shadow-md shadow-blue-600/20 group-hover:shadow-lg group-hover:shadow-blue-600/30 press-effect border-0">
                                    Get Started
                                    <ArrowRight size={16} className="ml-2 group-hover:translate-x-1 transition-transform duration-300" />
                                </Button>
                            </div>
                        </div>
                    </motion.div>

                    {/* Team Server (In-Cluster) */}
                    <motion.div variants={item} className="h-full">
                        <div
                            onClick={() => handleSelectMode('in-cluster')}
                            onMouseEnter={() => setHoveredCard('cluster')}
                            onMouseLeave={() => setHoveredCard(null)}
                            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleSelectMode('in-cluster'); } }}
                            role="button"
                            tabIndex={0}
                            aria-label="Deploy Team Server mode — deployed to your Kubernetes cluster"
                            className={cn(
                                "group relative h-full bg-white dark:bg-[hsl(228,14%,11%)] border border-slate-200/80 dark:border-slate-700/60 cursor-pointer overflow-hidden p-6 md:p-7 rounded-2xl transition-all duration-500",
                                "hover:border-purple-300/60 dark:hover:border-purple-500/40 hover:-translate-y-1",
                                "focus-visible:ring-2 focus-visible:ring-purple-500/50 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-[hsl(228,14%,7%)]",
                                hoveredCard === 'cluster' ? 'shadow-[0_16px_48px_-12px_rgba(147,51,234,0.15)] dark:shadow-[0_16px_48px_-12px_rgba(147,51,234,0.25)]' : 'shadow-[0_4px_24px_-4px_rgba(0,0,0,0.06)] dark:shadow-[0_4px_24px_-4px_rgba(0,0,0,0.3)]',
                            )}
                        >
                            {/* Hover gradient */}
                            <div className="absolute inset-0 bg-gradient-to-br from-purple-50/80 via-transparent to-violet-50/40 dark:from-purple-950/30 dark:via-transparent dark:to-violet-950/20 opacity-0 group-hover:opacity-100 transition-opacity duration-700" aria-hidden="true" />

                            <div className="relative z-10 h-full flex flex-col">
                                <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-purple-500 to-purple-600 flex items-center justify-center mb-4 shadow-lg shadow-purple-500/20 group-hover:scale-110 group-hover:shadow-xl group-hover:shadow-purple-500/30 transition-all duration-500 ease-spring">
                                    <Cloud className="text-white" size={22} />
                                </div>

                                <h3 className="text-xl md:text-2xl font-bold mb-1 tracking-tight text-slate-900 dark:text-slate-100">
                                    Team Server
                                </h3>
                                <p className="text-xs font-semibold uppercase tracking-widest text-purple-500 dark:text-purple-400 mb-3">Deployed to your cluster</p>
                                <p className="text-slate-500 dark:text-slate-400 mb-5 leading-relaxed text-[13px] font-medium">
                                    Server-side deployment via Helm. Shared by your team with SSO authentication, RBAC governance, and persistent monitoring.
                                </p>

                                <ul className="space-y-2.5 mb-6 flex-grow">
                                    {[
                                        'One-command Helm deployment',
                                        'Shared team workspaces with SSO',
                                        'Persistent monitoring & analytics',
                                        'Role-based access control (RBAC)',
                                    ].map((feature) => (
                                        <li key={feature} className="flex items-center gap-2.5 text-[13px] text-slate-600 dark:text-slate-400 font-medium">
                                            <div className="flex-shrink-0 w-4.5 h-4.5 rounded-full bg-purple-100 dark:bg-purple-900/40 flex items-center justify-center">
                                                <CheckCircle2 size={11} className="text-purple-600 dark:text-purple-400" />
                                            </div>
                                            {feature}
                                        </li>
                                    ))}
                                </ul>

                                <Button className="w-full bg-purple-600 hover:bg-purple-700 text-white rounded-xl h-11 text-sm font-semibold transition-all duration-300 shadow-md shadow-purple-600/20 group-hover:shadow-lg group-hover:shadow-purple-600/30 press-effect border-0">
                                    Deploy to Cluster
                                    <ArrowRight size={16} className="ml-2 group-hover:translate-x-1 transition-transform duration-300" />
                                </Button>
                            </div>
                        </div>
                    </motion.div>
                </div>

                {/* Bottom section */}
                <motion.div variants={item} className="flex flex-col items-center gap-5">
                    <button
                        onClick={() => setShowComparison(true)}
                        className="flex items-center gap-2 text-slate-400 hover:text-slate-700 dark:hover:text-slate-300 transition-colors duration-300 text-xs font-semibold tracking-wide press-effect"
                        aria-label="Compare Personal and Team Server modes"
                    >
                        <Info size={14} className="text-blue-500" />
                        Compare modes in detail
                    </button>

                    {/* Stats strip */}
                    <div className="flex items-center gap-6 md:gap-10 py-3.5 px-8 md:px-12 rounded-xl bg-white/60 dark:bg-white/5 border border-slate-200/60 dark:border-slate-700/40 backdrop-blur-sm shadow-sm">
                        <div className="flex flex-col items-center text-center">
                            <span className="text-xl md:text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">70+</span>
                            <span className="text-xs uppercase tracking-[0.2em] text-slate-400 font-bold mt-0.5">Resources</span>
                        </div>
                        <div className="w-px h-7 bg-slate-200 dark:bg-slate-700" aria-hidden="true" />
                        <div className="flex flex-col items-center text-center">
                            <span className="text-xl md:text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">Real-Time</span>
                            <span className="text-xs uppercase tracking-[0.2em] text-slate-400 font-bold mt-0.5">Discovery</span>
                        </div>
                        <div className="w-px h-7 bg-slate-200 dark:bg-slate-700" aria-hidden="true" />
                        <div className="flex flex-col items-center text-center">
                            <span className="text-xl md:text-2xl font-bold tracking-tight bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent flex items-center gap-1.5">
                                <Sparkles size={16} className="text-blue-500" />
                                AI
                            </span>
                            <span className="text-xs uppercase tracking-[0.2em] text-slate-400 font-bold mt-0.5">Augmented</span>
                        </div>
                    </div>
                </motion.div>
            </motion.div>

            {/* Comparison Dialog */}
            <Dialog open={showComparison} onOpenChange={setShowComparison}>
                <DialogContent className="max-w-4xl bg-white dark:bg-[hsl(228,14%,11%)] border-slate-200 dark:border-slate-700 text-foreground rounded-3xl p-8 md:p-12 shadow-2xl overflow-hidden">
                    <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-blue-500 via-purple-500 to-blue-500 opacity-60" aria-hidden="true" />

                    <DialogHeader className="mb-8">
                        <DialogTitle className="text-3xl md:text-4xl font-bold tracking-tight text-slate-900 dark:text-slate-100 mb-3">Compare Modes</DialogTitle>
                        <DialogDescription className="text-base text-slate-500 dark:text-slate-400 font-medium">
                            Choose the mode that matches your team size and infrastructure requirements.
                        </DialogDescription>
                    </DialogHeader>

                    <div className="overflow-hidden rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-900/50">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b border-slate-200 dark:border-slate-700 bg-slate-100/80 dark:bg-slate-800/80">
                                    <th className="p-5 text-left font-bold text-slate-500 dark:text-slate-400 uppercase text-xs tracking-widest">Dimension</th>
                                    <th className="p-5 text-center font-bold text-blue-600 dark:text-blue-400">
                                        <span className="flex items-center justify-center gap-2">
                                            <Monitor size={15} /> Personal
                                        </span>
                                    </th>
                                    <th className="p-5 text-center font-bold text-purple-600 dark:text-purple-400">
                                        <span className="flex items-center justify-center gap-2">
                                            <Cloud size={15} /> Team Server
                                        </span>
                                    </th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                                {[
                                    { name: 'Installation', desktop: 'Download & run', cluster: 'helm install kubilitics' },
                                    { name: 'Who uses it', desktop: 'Individual developer', cluster: 'Engineering team (5-500+)' },
                                    { name: 'Data storage', desktop: '100% on your machine', cluster: 'In-cluster (VPC-bound)' },
                                    { name: 'Authentication', desktop: 'Not needed (local)', cluster: 'SSO / RBAC / API keys' },
                                    { name: 'Collaboration', desktop: 'Private workstation', cluster: 'Shared team dashboards' },
                                    { name: 'Updates', desktop: 'Auto-update (desktop)', cluster: 'Helm upgrade / GitOps' },
                                ].map((row) => (
                                    <tr key={row.name} className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors duration-200">
                                        <td className="p-5 font-semibold text-slate-700 dark:text-slate-300">{row.name}</td>
                                        <td className="p-5 text-center text-slate-500 dark:text-slate-400 font-medium">{row.desktop}</td>
                                        <td className="p-5 text-center text-slate-500 dark:text-slate-400 font-medium">{row.cluster}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>

                    <div className="mt-8 grid grid-cols-3 gap-4">
                        <div className="p-5 rounded-2xl bg-blue-50/60 dark:bg-blue-950/30 border border-blue-100 dark:border-blue-800/40 flex flex-col items-center text-center group transition-all hover:bg-blue-50 dark:hover:bg-blue-950/50">
                            <Zap className="text-blue-500 mb-2.5 group-hover:scale-110 transition-transform" size={22} />
                            <span className="text-xs font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">Performance</span>
                        </div>
                        <div className="p-5 rounded-2xl bg-purple-50/60 dark:bg-purple-950/30 border border-purple-100 dark:border-purple-800/40 flex flex-col items-center text-center group transition-all hover:bg-purple-50 dark:hover:bg-purple-950/50">
                            <Shield className="text-purple-500 mb-2.5 group-hover:scale-110 transition-transform" size={22} />
                            <span className="text-xs font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">Security</span>
                        </div>
                        <div className="p-5 rounded-2xl bg-emerald-50/60 dark:bg-emerald-950/30 border border-emerald-100 dark:border-emerald-800/40 flex flex-col items-center text-center group transition-all hover:bg-emerald-50 dark:hover:bg-emerald-950/50">
                            <BarChart3 className="text-emerald-500 mb-2.5 group-hover:scale-110 transition-transform" size={22} />
                            <span className="text-xs font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">Scale</span>
                        </div>
                    </div>
                </DialogContent>
            </Dialog>
        </div>
    );
}
