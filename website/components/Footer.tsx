"use client";

import Link from "next/link";
import Image from "next/image";
import logo from "@/public/brand/logo-dark.png";

const groups = [
    {
        title: "Product",
        links: [
            { label: "Features", href: "#features" },
            { label: "How It Works", href: "#how-it-works" },
            { label: "Comparison", href: "#comparison" },
            { label: "Enterprise", href: "#enterprise" },
        ],
    },
    {
        title: "Resources",
        links: [
            { label: "Documentation", href: "#", ext: false },
            { label: "Changelog", href: "#", ext: false },
            { label: "GitHub", href: "https://github.com/kubilitics", ext: true },
            { label: "Issues", href: "https://github.com/kubilitics/issues", ext: true },
        ],
    },
    {
        title: "Legal",
        links: [
            { label: "Apache 2.0 License", href: "#" },
            { label: "Privacy Policy", href: "#" },
            { label: "Security", href: "#" },
        ],
    },
];

export default function Footer() {
    return (
        <footer className="relative bg-[#06080C] border-t border-[#1D2535]">
            <div className="max-w-7xl mx-auto px-5 lg:px-8 py-16">
                {/* Grid */}
                <div className="grid grid-cols-1 lg:grid-cols-5 gap-12 mb-14">
                    {/* Brand */}
                    <div className="lg:col-span-2">
                        <Link href="/" className="flex items-center gap-2.5 group w-fit mb-5">
                            <Image
                                src={logo}
                                alt="Kubilitics"
                                className="h-8 w-auto"
                            />
                        </Link>
                        <p className="text-[0.9375rem] leading-[1.7] text-[#5A6880] max-w-xs mb-5">
                            Kubernetes Relationship Intelligence Engine.
                            <br />
                            Open source. Apache 2.0.
                        </p>
                        <a
                            href="https://github.com/kubilitics"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-2 text-[13px] font-medium text-[#9BAABE] hover:text-[#EEF2F7] transition-colors duration-200"
                        >
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
                                <path d="M12 0C5.374 0 0 5.373 0 12c0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.509 11.509 0 0112 5.803c1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576C20.566 21.797 24 17.3 24 12c0-6.627-5.373-12-12-12z" />
                            </svg>
                            github.com/kubilitics
                        </a>
                    </div>

                    {/* Link groups */}
                    {groups.map((g) => (
                        <div key={g.title}>
                            <p className="text-[10px] font-semibold tracking-[0.12em] uppercase text-[#5A6880] mb-4">
                                {g.title}
                            </p>
                            <ul className="flex flex-col gap-3">
                                {g.links.map((l) => (
                                    <li key={l.label}>
                                        <a
                                            href={l.href}
                                            target={(l as { ext?: boolean }).ext ? "_blank" : undefined}
                                            rel={(l as { ext?: boolean }).ext ? "noopener noreferrer" : undefined}
                                            className="text-[0.875rem] text-[#9BAABE] hover:text-[#EEF2F7] transition-colors duration-200"
                                        >
                                            {l.label}
                                        </a>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    ))}
                </div>

                {/* Bottom */}
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pt-8 border-t border-[#1D2535]">
                    <p className="text-[12px] text-[#5A6880]">
                        © {new Date().getFullYear()} Kubilitics. Built for engineers who care about production stability.
                    </p>
                    <p className="text-[12px] text-[#5A6880]">
                        Released under{" "}
                        <a href="#" className="text-[#9BAABE] hover:text-[#EEF2F7] transition-colors">Apache 2.0</a>
                    </p>
                </div>
            </div>
        </footer>
    );
}
