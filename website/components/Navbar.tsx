"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import Link from "next/link";
import Image from "next/image";
import logo from "@/public/brand/logo-transparent.png";

const links = [
    { label: "Features", href: "#features" },
    { label: "How It Works", href: "#how-it-works" },
    { label: "Compare", href: "#comparison" },
    { label: "Enterprise", href: "#enterprise" },
    { label: "Open Source", href: "#opensource" },
];

export default function Navbar() {
    const [scrolled, setScrolled] = useState(false);
    const [open, setOpen] = useState(false);

    useEffect(() => {
        const fn = () => setScrolled(window.scrollY > 24);
        window.addEventListener("scroll", fn, { passive: true });
        return () => window.removeEventListener("scroll", fn);
    }, []);

    return (
        <motion.header
            initial={{ opacity: 0, y: -16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
            className={`fixed inset-x-0 top-0 z-50 transition-all duration-300 ${scrolled
                    ? "bg-[#06080C]/85 backdrop-blur-2xl border-b border-[#1D2535]/80"
                    : "bg-transparent"
                }`}
        >
            <div className="max-w-7xl mx-auto px-5 lg:px-8">
                <div className="flex items-center justify-between h-[60px]">
                    {/* Logo */}
                    <Link href="/" className="flex items-center gap-2.5 group shrink-0">
                        <Image
                            src={logo}
                            alt="Kubilitics"
                            className="h-8 w-auto"
                            priority
                        />
                    </Link>

                    {/* Desktop nav */}
                    <nav className="hidden lg:flex items-center gap-7">
                        {links.map((l) => (
                            <a
                                key={l.label}
                                href={l.href}
                                className="text-[13px] font-medium text-[#9BAABE] hover:text-[#EEF2F7] transition-colors duration-200"
                            >
                                {l.label}
                            </a>
                        ))}
                    </nav>

                    {/* CTA */}
                    <div className="hidden lg:flex items-center gap-3">
                        <a
                            href="https://github.com/kubilitics"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-1.5 text-[13px] font-medium text-[#9BAABE] hover:text-[#EEF2F7] transition-colors duration-200"
                        >
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
                                <path d="M12 0C5.374 0 0 5.373 0 12c0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.509 11.509 0 0112 5.803c1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576C20.566 21.797 24 17.3 24 12c0-6.627-5.373-12-12-12z" />
                            </svg>
                            GitHub
                        </a>
                        <a
                            href="#cta"
                            className="px-4 py-2 rounded-xl text-[13px] font-semibold text-white bg-[#4F7BF7] hover:bg-[#3560D8] active:scale-[0.98] transition-all duration-200 shadow-glow-sm hover:shadow-glow-md"
                        >
                            Get Started
                        </a>
                    </div>

                    {/* Mobile hamburger */}
                    <button
                        onClick={() => setOpen(!open)}
                        className="lg:hidden w-9 h-9 rounded-lg flex items-center justify-center text-[#9BAABE] hover:text-[#EEF2F7] hover:bg-[#1D2535] transition-colors"
                        aria-label="Menu"
                    >
                        {open ? (
                            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                                <line x1="3" y1="3" x2="15" y2="15" />
                                <line x1="15" y1="3" x2="3" y2="15" />
                            </svg>
                        ) : (
                            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                                <line x1="3" y1="5" x2="15" y2="5" />
                                <line x1="3" y1="9" x2="15" y2="9" />
                                <line x1="3" y1="13" x2="15" y2="13" />
                            </svg>
                        )}
                    </button>
                </div>
            </div>

            {/* Mobile menu */}
            <AnimatePresence>
                {open && (
                    <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        exit={{ opacity: 0, height: 0 }}
                        transition={{ duration: 0.22, ease: "easeOut" }}
                        className="lg:hidden bg-[#0B0E14] border-b border-[#1D2535] overflow-hidden"
                    >
                        <div className="px-5 py-5 flex flex-col gap-4">
                            {links.map((l) => (
                                <a
                                    key={l.label}
                                    href={l.href}
                                    onClick={() => setOpen(false)}
                                    className="text-[14px] text-[#9BAABE] hover:text-[#EEF2F7] font-medium transition-colors"
                                >
                                    {l.label}
                                </a>
                            ))}
                            <div className="flex gap-3 pt-3 border-t border-[#1D2535]">
                                <a href="https://github.com/kubilitics" target="_blank" rel="noopener noreferrer"
                                    className="text-[13px] text-[#9BAABE] hover:text-[#EEF2F7] font-medium transition-colors">
                                    GitHub
                                </a>
                                <a href="#cta" className="px-4 py-2 rounded-lg text-[13px] font-semibold text-white bg-[#4F7BF7]">
                                    Get Started
                                </a>
                            </div>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </motion.header>
    );
}
