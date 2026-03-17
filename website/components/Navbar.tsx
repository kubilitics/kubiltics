"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useTheme } from "next-themes";
import Image from "next/image";
import Link from "next/link";

const links = [
  { label: "Features", href: "#features" },
  { label: "How It Works", href: "#how-it-works" },
  { label: "Install", href: "#install" },
  { label: "Security", href: "#security" },
];

function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (!mounted) return <div className="w-11 h-11" />;

  return (
    <button
      onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
      className="w-11 h-11 rounded-xl flex items-center justify-center transition-all duration-200 hover:bg-[var(--bg-tertiary)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
      aria-label="Toggle theme"
    >
      {theme === "dark" ? (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="5" />
          <line x1="12" y1="1" x2="12" y2="3" /><line x1="12" y1="21" x2="12" y2="23" />
          <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" /><line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
          <line x1="1" y1="12" x2="3" y2="12" /><line x1="21" y1="12" x2="23" y2="12" />
          <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" /><line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
        </svg>
      ) : (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" />
        </svg>
      )}
    </button>
  );
}

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
      className={`fixed inset-x-0 top-0 z-50 transition-all duration-300 ${
        scrolled
          ? "bg-[var(--bg-primary)]/90 backdrop-blur-2xl border-b border-[var(--border-primary)] shadow-sm"
          : "bg-transparent"
      }`}
    >
      <div className="max-w-[1200px] mx-auto px-6 md:px-8 lg:px-10">
        <div className="flex items-center justify-between h-[72px] lg:h-[80px]">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-3 shrink-0 group">
            <div className="relative">
              <div className="absolute -inset-2 rounded-2xl bg-[var(--brand)] opacity-0 group-hover:opacity-15 blur-lg transition-opacity duration-400" />
              <Image src="/brand/logo-mark-rounded.png" alt="Kubilitics" width={38} height={38} className="relative rounded-xl logo-glow" priority />
            </div>
            <span className="text-[18px] font-bold tracking-[-0.025em] text-[var(--text-primary)]">Kubilitics</span>
          </Link>

          {/* Center nav — pill-shaped */}
          <nav className="hidden lg:flex items-center gap-1 px-2 py-2 rounded-2xl bg-[var(--bg-tertiary)]/50 border border-[var(--border-primary)]/50">
            {links.map((l) => (
              <a
                key={l.label}
                href={l.href}
                className="px-5 py-2.5 rounded-xl text-[15px] font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card)] transition-all duration-200"
              >
                {l.label}
              </a>
            ))}
          </nav>

          {/* Right side — theme toggle + CTA */}
          <div className="hidden lg:flex items-center gap-3">
            <ThemeToggle />
            <a
              href="#install"
              className="px-6 py-3 rounded-xl text-[15px] font-semibold text-white bg-[var(--brand)] hover:bg-[var(--brand-hover)] active:scale-[0.97] transition-all duration-200 shadow-md shadow-blue-500/15"
            >
              Get Started Free
            </a>
          </div>

          {/* Mobile */}
          <div className="flex lg:hidden items-center gap-1">
            <ThemeToggle />
            <button onClick={() => setOpen(!open)} className="w-11 h-11 rounded-xl flex items-center justify-center text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] transition-colors" aria-label="Menu">
              {open ? (
                <svg width="22" height="22" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><line x1="4" y1="4" x2="16" y2="16" /><line x1="16" y1="4" x2="4" y2="16" /></svg>
              ) : (
                <svg width="22" height="22" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><line x1="3" y1="6" x2="17" y2="6" /><line x1="3" y1="10" x2="17" y2="10" /><line x1="3" y1="14" x2="17" y2="14" /></svg>
              )}
            </button>
          </div>
        </div>
      </div>

      <AnimatePresence>
        {open && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.2, ease: "easeOut" }} className="lg:hidden bg-[var(--bg-card)] border-b border-[var(--border-primary)] overflow-hidden">
            <div className="px-6 py-6 flex flex-col gap-4">
              {links.map((l) => (
                <a key={l.label} href={l.href} onClick={() => setOpen(false)} className="text-[15px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] font-medium transition-colors">{l.label}</a>
              ))}
              <div className="pt-4 border-t border-[var(--border-primary)]">
                <a href="#install" onClick={() => setOpen(false)} className="inline-flex px-5 py-2.5 rounded-xl text-[14px] font-semibold text-white bg-[var(--brand)]">Get Started Free</a>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.header>
  );
}
