import React from "react";
import { Link } from "react-router-dom";
import {
    Server,
    Activity,
    Layers,
    Globe,
    FolderKanban,
    Shield,
    FileText,
    KeyRound,
    Timer,
    ArrowRight,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useResourceCounts } from "@/hooks/useResourceCounts";
import { useProjectStore } from "@/stores/projectStore";

/** Cards whose count is always cluster-wide (not filtered by project namespaces). */
const CLUSTER_WIDE_COUNT_TITLES = new Set(["Nodes"]);

export const MetricCardsGrid = () => {
    const { counts } = useResourceCounts();
    const activeProject = useProjectStore((s) => s.activeProject);
    const isProjectScope = !!activeProject;

    const cardConfigs: Array<{
        title: string;
        value: number;
        href: string;
        icon: typeof Server;
        gradClass: string;
        iconBg: string;
        iconColor: string;
    }> = [
            // — Infrastructure —
            {
                title: "Nodes",
                value: counts.nodes,
                href: "/nodes",
                icon: Server,
                gradClass: "grad-blue",
                iconBg: "bg-blue-600",
                iconColor: "text-white",
            },
            {
                title: "Pods",
                value: counts.pods,
                href: "/pods",
                icon: Activity,
                gradClass: "grad-violet",
                iconBg: "bg-violet-600",
                iconColor: "text-white",
            },
            {
                title: "Deployments",
                value: counts.deployments,
                href: "/deployments",
                icon: Layers,
                gradClass: "grad-violet",
                iconBg: "bg-purple-600",
                iconColor: "text-white",
            },
            // — Networking & Organization —
            {
                title: "Services",
                value: counts.services,
                href: "/services",
                icon: Globe,
                gradClass: "grad-emerald",
                iconBg: "bg-emerald-600",
                iconColor: "text-white",
            },
            {
                title: "DaemonSets",
                value: counts.daemonsets,
                href: "/daemonsets",
                icon: Shield,
                gradClass: "grad-rose",
                iconBg: "bg-rose-600",
                iconColor: "text-white",
            },
            {
                title: "Namespaces",
                value: counts.namespaces,
                href: "/namespaces",
                icon: FolderKanban,
                gradClass: "grad-emerald",
                iconBg: "bg-teal-600",
                iconColor: "text-white",
            },
            // — Configuration & Security —
            {
                title: "ConfigMaps",
                value: counts.configmaps,
                href: "/configmaps",
                icon: FileText,
                gradClass: "grad-amber",
                iconBg: "bg-amber-600",
                iconColor: "text-white",
            },
            {
                title: "Secrets",
                value: counts.secrets,
                href: "/secrets",
                icon: KeyRound,
                gradClass: "grad-rose",
                iconBg: "bg-pink-600",
                iconColor: "text-white",
            },
            {
                title: "CronJobs",
                value: counts.cronjobs,
                href: "/cronjobs",
                icon: Timer,
                gradClass: "grad-amber",
                iconBg: "bg-orange-600",
                iconColor: "text-white",
            },
        ];

    return (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8 auto-rows-fr">
            {cardConfigs.map((metric) => (
                <Link key={metric.title} to={metric.href} className="block group hover:no-underline h-full">
                    <div className={`glass-card glass-card-hover p-8 h-full relative overflow-hidden flex flex-col justify-between ${metric.gradClass}`}>
                        {/* Subtle Top Shine */}
                        <div className="absolute top-0 left-0 w-full h-px bg-gradient-to-r from-transparent via-white/50 to-transparent z-20" />

                        <div className="flex justify-between items-start relative z-10 mb-8">
                            <div className="space-y-1">
                                <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.25em]">
                                    {metric.title}
                                </h3>
                                <div className="text-4xl font-bold tracking-tight text-slate-900 tabular-nums">
                                    {metric.value}
                                </div>
                            </div>

                            <div className={`h-14 w-14 rounded-2xl ${metric.iconBg} flex items-center justify-center shadow-lg shadow-black/5 group-hover:-translate-y-1 group-hover:scale-110 transition-all duration-700 ease-spring`}>
                                <metric.icon className="h-7 w-7 text-white" />
                            </div>
                        </div>

                        <div className="flex items-center justify-between relative z-10 pt-6 border-t border-white/40">
                            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">
                                {isProjectScope
                                    ? CLUSTER_WIDE_COUNT_TITLES.has(metric.title)
                                        ? "Global Cluster"
                                        : "Project Context"
                                    : "Live Engine View"}
                            </p>
                            <div className="h-9 w-9 rounded-full bg-white/50 flex items-center justify-center opacity-0 group-hover:opacity-100 group-hover:translate-x-1 transition-all duration-700 ease-spring">
                                <ArrowRight className="h-5 w-5 text-slate-600" />
                            </div>
                        </div>

                        {/* Background Accent */}
                        <div className="absolute -bottom-10 -right-10 w-32 h-32 bg-white/5 blur-3xl rounded-full" />
                    </div>
                </Link>
            ))}
        </div>
    );
};

