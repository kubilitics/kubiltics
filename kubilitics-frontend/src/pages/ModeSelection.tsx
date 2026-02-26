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
    Info
} from 'lucide-react';
import { KubiliticsLogo, KubiliticsText } from '../components/icons/KubernetesIcons';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
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
            staggerChildren: 0.12,
            delayChildren: 0.1
        }
    }
};

const item: Variants = {
    hidden: { opacity: 0, y: 20 },
    show: { opacity: 1, y: 0, transition: { duration: 0.8, ease: [0.16, 1, 0.3, 1] } }
};

export default function ModeSelection() {
    const navigate = useNavigate();
    const setAppMode = useClusterStore((s) => s.setAppMode);
    const [showComparison, setShowComparison] = useState(false);

    const handleSelectMode = (mode: 'desktop' | 'in-cluster') => {
        setAppMode(mode);
        navigate('/connect');
    };

    return (
        <div className="relative min-h-screen bg-[#02040a] text-slate-50 overflow-hidden flex flex-col items-center justify-center p-8">
            {/* Apple-style Animated Background Mesh */}
            <div className="absolute inset-0 overflow-hidden pointer-events-none">
                <div className="absolute top-[-15%] left-[-10%] w-[60%] h-[60%] bg-blue-600/10 rounded-full blur-[140px] animate-pulse" style={{ animationDuration: '8s' }} />
                <div className="absolute bottom-[-15%] right-[-10%] w-[60%] h-[60%] bg-indigo-600/10 rounded-full blur-[140px] animate-pulse" style={{ animationDuration: '10s', animationDelay: '2s' }} />
                <div className="absolute top-[20%] right-[-5%] w-[30%] h-[40%] bg-purple-600/5 rounded-full blur-[100px]" />
            </div>

            <motion.div
                variants={container}
                initial="hidden"
                animate="show"
                className="relative z-10 w-full max-w-6xl"
            >
                <motion.div variants={item} className="text-center mb-20">
                    <div className="flex flex-col items-center justify-center gap-6 mb-10">
                        <div className="relative group">
                            <div className="absolute inset-0 bg-blue-500/30 blur-2xl rounded-full scale-0 group-hover:scale-150 transition-transform duration-1000 opacity-50" />
                            <KubiliticsLogo size={56} className="text-blue-500 transition-transform duration-700 ease-spring group-hover:scale-110" />
                        </div>
                        <KubiliticsText height={32} className="text-white opacity-90" />
                    </div>

                    <h1 className="text-5xl md:text-7xl font-bold mb-6 tracking-tighter leading-[1.1] text-transparent bg-clip-text bg-gradient-to-b from-white to-white/60">
                        Choose your journey.
                    </h1>
                    <p className="text-lg md:text-xl text-slate-400 max-w-2xl mx-auto leading-relaxed font-medium">
                        The ultimate Kubernetes Operating System. Designed for performance,
                        architected for multi-cloud, built for humanity.
                    </p>
                </motion.div>

                <div className="grid md:grid-cols-2 gap-10 mb-16">
                    {/* Desktop Mode Card */}
                    <motion.div variants={item} className="h-full">
                        <Card
                            onClick={() => handleSelectMode('desktop')}
                            className={cn(
                                "group relative h-full bg-slate-900/40 border-slate-800/50 backdrop-blur-3xl transition-all duration-700 cursor-pointer overflow-hidden p-10 rounded-[2.5rem]",
                                "hover:border-blue-500/40 hover:bg-slate-900/60 hover:shadow-[0_20px_40px_rgba(0,0,0,0.4)] hover:-translate-y-2",
                                "before:absolute before:inset-0 before:p-[1px] before:bg-gradient-to-br before:from-white/10 before:to-transparent before:rounded-[2.5rem] before:-z-10"
                            )}
                        >
                            <div className="absolute -top-12 -right-12 w-48 h-48 bg-blue-500/5 rounded-full blur-3xl group-hover:bg-blue-500/10 transition-colors duration-700" />

                            <div className="relative z-10 h-full flex flex-col">
                                <div className="w-16 h-16 rounded-[1.25rem] bg-blue-500/10 flex items-center justify-center mb-8 border border-blue-500/20 shadow-inner group-hover:scale-110 group-hover:bg-blue-600 transition-all duration-700 ease-spring">
                                    <Monitor className="text-blue-400 group-hover:text-white transition-colors duration-500" size={32} />
                                </div>
                                <h3 className="text-3xl font-bold mb-4 tracking-tight text-slate-50 group-hover:text-blue-400 transition-colors duration-500">
                                    Desktop Engine
                                </h3>
                                <p className="text-slate-400 mb-10 leading-relaxed text-base font-medium">
                                    A high-fidelity local experience. Auto-detects your environment and runs entirely on your silicon. Zero latency, maximum privacy.
                                </p>

                                <ul className="space-y-4 mb-12 flex-grow">
                                    {[
                                        'Ambient kubeconfig discovery',
                                        'Optimized for Silicon architecture',
                                        'Offline-first synchronization',
                                        'Deep system-level integration'
                                    ].map((feature) => (
                                        <li key={feature} className="flex items-center gap-4 text-sm text-slate-300/80 font-medium">
                                            <div className="flex-shrink-0 w-5 h-5 rounded-full bg-blue-500/20 flex items-center justify-center">
                                                <CheckCircle2 size={12} className="text-blue-400" />
                                            </div>
                                            {feature}
                                        </li>
                                    ))}
                                </ul>

                                <Button className="w-full bg-blue-600 hover:bg-blue-500 text-white rounded-2xl h-14 text-base font-bold transition-all shadow-[0_8px_16px_rgba(37,99,235,0.2)] group-hover:shadow-[0_12px_24px_rgba(37,99,235,0.35)] group-hover:translate-x-1 border border-white/10">
                                    Launch Desktop
                                    <ArrowRight size={20} className="ml-2 group-hover:translate-x-1 transition-transform" />
                                </Button>
                            </div>
                        </Card>
                    </motion.div>

                    {/* In-Cluster Card */}
                    <motion.div variants={item} className="h-full">
                        <Card
                            onClick={() => handleSelectMode('in-cluster')}
                            className={cn(
                                "group relative h-full bg-slate-900/40 border-slate-800/50 backdrop-blur-3xl transition-all duration-700 cursor-pointer overflow-hidden p-10 rounded-[2.5rem]",
                                "hover:border-purple-500/40 hover:bg-slate-900/60 hover:shadow-[0_20px_40px_rgba(0,0,0,0.4)] hover:-translate-y-2",
                                "before:absolute before:inset-0 before:p-[1px] before:bg-gradient-to-br before:from-white/10 before:to-transparent before:rounded-[2.5rem] before:-z-10"
                            )}
                        >
                            <div className="absolute -top-12 -right-12 w-48 h-48 bg-purple-500/5 rounded-full blur-3xl group-hover:bg-purple-500/10 transition-colors duration-700" />

                            <div className="relative z-10 h-full flex flex-col">
                                <div className="w-16 h-16 rounded-[1.25rem] bg-purple-500/10 flex items-center justify-center mb-8 border border-purple-500/20 shadow-inner group-hover:scale-110 group-hover:bg-purple-600 transition-all duration-700 ease-spring">
                                    <Cloud className="text-purple-400 group-hover:text-white transition-colors duration-500" size={32} />
                                </div>
                                <h3 className="text-3xl font-bold mb-4 tracking-tight text-slate-50 group-hover:text-purple-400 transition-colors duration-500">
                                    In-Cluster OS
                                </h3>
                                <p className="text-slate-400 mb-10 leading-relaxed text-base font-medium">
                                    Server-side orchestration. Perfect for engineering teams, persistent monitoring, and organization-wide visibility.
                                </p>

                                <ul className="space-y-4 mb-12 flex-grow">
                                    {[
                                        'Native K8s deployment (Helm)',
                                        'Collaborative team workspaces',
                                        'Persistent cloud analytics',
                                        'Unified governance & RBAC'
                                    ].map((feature) => (
                                        <li key={feature} className="flex items-center gap-4 text-sm text-slate-300/80 font-medium">
                                            <div className="flex-shrink-0 w-5 h-5 rounded-full bg-purple-500/20 flex items-center justify-center">
                                                <CheckCircle2 size={12} className="text-purple-400" />
                                            </div>
                                            {feature}
                                        </li>
                                    ))}
                                </ul>

                                <Button className="w-full bg-purple-600 hover:bg-purple-500 text-white rounded-2xl h-14 text-base font-bold transition-all shadow-[0_8px_16px_rgba(147,51,234,0.2)] group-hover:shadow-[0_12px_24px_rgba(147,51,234,0.35)] group-hover:translate-x-1 border border-white/10">
                                    Deploy Cluster OS
                                    <ArrowRight size={20} className="ml-2 group-hover:translate-x-1 transition-transform" />
                                </Button>
                            </div>
                        </Card>
                    </motion.div>
                </div>

                <motion.div variants={item} className="flex flex-col items-center gap-10">
                    <button
                        onClick={() => setShowComparison(true)}
                        className="flex items-center gap-2.5 text-slate-500 hover:text-white transition-all text-sm font-semibold tracking-wide"
                    >
                        <Info size={16} className="text-blue-400" />
                        Compare operational modes
                    </button>

                    <div className="flex items-center gap-12 py-6 px-16 rounded-[2rem] bg-slate-950/40 border border-white/5 backdrop-blur-3xl shadow-2xl relative overflow-hidden group">
                        <div className="absolute inset-0 bg-gradient-to-r from-blue-500/5 via-transparent to-purple-500/5 opacity-0 group-hover:opacity-100 transition-opacity duration-1000" />

                        <div className="flex flex-col items-center text-center relative z-10">
                            <span className="text-3xl font-bold tracking-tighter text-white">50+</span>
                            <span className="text-[10px] uppercase tracking-[0.2em] text-slate-500 font-bold mt-1">Resources</span>
                        </div>
                        <div className="w-px h-10 bg-white/10" />
                        <div className="flex flex-col items-center text-center relative z-10">
                            <span className="text-3xl font-bold tracking-tighter text-white">Real-Time</span>
                            <span className="text-[10px] uppercase tracking-[0.2em] text-slate-500 font-bold mt-1">Discovery</span>
                        </div>
                        <div className="w-px h-10 bg-white/10" />
                        <div className="flex flex-col items-center text-center relative z-10">
                            <span className="text-3xl font-bold tracking-tighter text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-purple-400">AI</span>
                            <span className="text-[10px] uppercase tracking-[0.2em] text-slate-500 font-bold mt-1">Augmented</span>
                        </div>
                    </div>
                </motion.div>
            </motion.div>

            {/* Comparison Dialog - Redesigned for Apple Quality */}
            <Dialog open={showComparison} onOpenChange={setShowComparison}>
                <DialogContent className="max-w-4xl bg-slate-950/95 border-none text-slate-50 backdrop-blur-3xl rounded-[2.5rem] p-12 shadow-[0_25px_50px_-12px_rgba(0,0,0,0.5)] overflow-hidden">
                    <div className="absolute top-0 left-0 w-full h-[2px] bg-gradient-to-r from-transparent via-blue-500/50 to-transparent" />

                    <DialogHeader className="mb-10">
                        <DialogTitle className="text-4xl font-bold tracking-tighter mb-4 leading-tight">Compare Kubilitics Modes</DialogTitle>
                        <DialogDescription className="text-lg text-slate-400 font-medium">
                            Tailored for your specific infrastructure requirements and workflow scale.
                        </DialogDescription>
                    </DialogHeader>

                    <div className="overflow-hidden rounded-3xl border border-white/10 bg-black/20 shadow-inner">
                        <table className="w-full text-base">
                            <thead>
                                <tr className="border-b border-white/10 bg-white/5">
                                    <th className="p-6 text-left font-bold text-slate-400 uppercase text-xs tracking-widest">Dimension</th>
                                    <th className="p-6 text-center font-bold text-blue-400 flex items-center justify-center gap-2">
                                        <Monitor size={16} /> Desktop
                                    </th>
                                    <th className="p-6 text-center font-bold text-purple-400 flex items-center justify-center gap-2">
                                        <Cloud size={16} /> Cluster OS
                                    </th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-white/5">
                                {[
                                    { name: 'Installation', desktop: 'Direct Executable', cluster: 'Helm / K8s Native' },
                                    { name: 'Control Plane', desktop: 'Local Process', cluster: 'Shared Service' },
                                    { name: 'Data Sovereignty', desktop: '100% On-Device', cluster: 'VPC Bound' },
                                    { name: 'Live Updates', desktop: 'Per-instance', cluster: 'Managed / GitOps' },
                                    { name: 'Collaboration', desktop: 'Private Workstation', cluster: 'Multi-user Teams' },
                                ].map((row) => (
                                    <tr key={row.name} className="hover:bg-white/[0.02] transition-colors duration-300">
                                        <td className="p-6 font-bold text-slate-300 text-sm tracking-tight">{row.name}</td>
                                        <td className="p-6 text-center text-slate-400 font-medium">{row.desktop}</td>
                                        <td className="p-6 text-center text-slate-400 font-medium">{row.cluster}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>

                    <div className="mt-12 grid grid-cols-3 gap-6">
                        <div className="p-6 rounded-[1.5rem] bg-blue-500/5 border border-blue-500/10 backdrop-blur-xl flex flex-col items-center text-center group">
                            <Zap className="text-blue-400 mb-3 group-hover:scale-110 transition-transform" size={24} />
                            <span className="text-xs font-bold uppercase tracking-widest text-slate-500">Performance</span>
                        </div>
                        <div className="p-6 rounded-[1.5rem] bg-purple-500/5 border border-purple-500/10 backdrop-blur-xl flex flex-col items-center text-center group">
                            <Shield className="text-purple-400 mb-3 group-hover:scale-110 transition-transform" size={24} />
                            <span className="text-xs font-bold uppercase tracking-widest text-slate-500">Security</span>
                        </div>
                        <div className="p-6 rounded-[1.5rem] bg-emerald-500/5 border border-emerald-500/10 backdrop-blur-xl flex flex-col items-center text-center group">
                            <BarChart3 className="text-emerald-400 mb-3 group-hover:scale-110 transition-transform" size={24} />
                            <span className="text-xs font-bold uppercase tracking-widest text-slate-500">Scale</span>
                        </div>
                    </div>
                </DialogContent>
            </Dialog>
        </div>
    );
}
