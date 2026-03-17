"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useScrollReveal } from "@/hooks/useScrollReveal";

type Tab = "desktop" | "cli" | "cluster";

const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
  {
    id: "desktop",
    label: "Desktop App",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="3" width="20" height="14" rx="2" /><line x1="8" y1="21" x2="16" y2="21" /><line x1="12" y1="17" x2="12" y2="21" />
      </svg>
    ),
  },
  {
    id: "cli",
    label: "CLI (kcli)",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="4 17 10 11 4 5" /><line x1="12" y1="19" x2="20" y2="19" />
      </svg>
    ),
  },
  {
    id: "cluster",
    label: "In-Cluster",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2L3 7v10l9 5 9-5V7l-9-5z" />
      </svg>
    ),
  },
];

/* ── Terminal-style copy button ─────────────────────────────────────────── */
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
      className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] font-semibold uppercase tracking-wider transition-all duration-200 bg-white/[0.06] hover:bg-white/[0.12] text-white/50 hover:text-white/80 border border-white/[0.06]"
    >
      {copied ? (
        <>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
          Copied
        </>
      ) : (
        <>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" /></svg>
          Copy
        </>
      )}
    </button>
  );
}

/* ── Dark terminal code block ───────────────────────────────────────────── */
function TerminalBlock({ command, label }: { command: string; label?: string }) {
  return (
    <div className="group relative rounded-xl overflow-hidden bg-[#0d1117] border border-white/[0.06] shadow-lg shadow-black/20">
      {/* Terminal chrome bar */}
      <div className="flex items-center justify-between px-4 py-2.5 bg-white/[0.03] border-b border-white/[0.06]">
        <div className="flex items-center gap-2">
          <div className="flex gap-1.5">
            <div className="w-2.5 h-2.5 rounded-full bg-[#ff5f57]/80" />
            <div className="w-2.5 h-2.5 rounded-full bg-[#febc2e]/80" />
            <div className="w-2.5 h-2.5 rounded-full bg-[#28c840]/80" />
          </div>
          {label && (
            <span className="ml-3 text-[11px] font-medium text-white/30 uppercase tracking-wider">{label}</span>
          )}
        </div>
        <CopyButton text={command} />
      </div>
      {/* Command */}
      <div className="px-5 py-4 overflow-x-auto scrollbar-hide">
        <code className="text-[13px] lg:text-[14px] font-mono leading-relaxed whitespace-nowrap">
          <span className="text-emerald-400/80 select-none">$</span>
          <span className="text-white/80 ml-2">{command}</span>
        </code>
      </div>
    </div>
  );
}

/* ── Multi-line terminal block ──────────────────────────────────────────── */
function TerminalMulti({ commands, label }: { commands: { cmd: string; comment?: string }[]; label?: string }) {
  const fullText = commands.map((c) => c.cmd).join("\n");
  return (
    <div className="group relative rounded-xl overflow-hidden bg-[#0d1117] border border-white/[0.06] shadow-lg shadow-black/20">
      <div className="flex items-center justify-between px-4 py-2.5 bg-white/[0.03] border-b border-white/[0.06]">
        <div className="flex items-center gap-2">
          <div className="flex gap-1.5">
            <div className="w-2.5 h-2.5 rounded-full bg-[#ff5f57]/80" />
            <div className="w-2.5 h-2.5 rounded-full bg-[#febc2e]/80" />
            <div className="w-2.5 h-2.5 rounded-full bg-[#28c840]/80" />
          </div>
          {label && (
            <span className="ml-3 text-[11px] font-medium text-white/30 uppercase tracking-wider">{label}</span>
          )}
        </div>
        <CopyButton text={fullText} />
      </div>
      <div className="px-5 py-4 space-y-1.5 overflow-x-auto scrollbar-hide">
        {commands.map((c, i) => (
          <div key={i} className="flex items-start gap-0">
            <code className="text-[13px] lg:text-[14px] font-mono leading-relaxed whitespace-nowrap">
              <span className="text-emerald-400/80 select-none">$</span>
              <span className="text-white/80 ml-2">{c.cmd}</span>
            </code>
            {c.comment && (
              <span className="ml-3 text-[12px] font-mono text-white/20 whitespace-nowrap">{c.comment}</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── OS Download Card ───────────────────────────────────────────────────── */
function OSCard({
  icon,
  name,
  detail,
  buttonLabel,
  href,
}: {
  icon: React.ReactNode;
  name: string;
  detail: string;
  buttonLabel: string;
  href: string;
}) {
  return (
    <a
      href={href}
      className="group relative flex flex-col items-center gap-4 p-8 rounded-2xl border border-[var(--border-primary)] bg-[var(--bg-card)] hover:border-[var(--brand)]/40 transition-all duration-300 hover:shadow-xl hover:shadow-[var(--brand)]/5 card-lift"
    >
      {/* Hover glow */}
      <div className="absolute inset-0 rounded-2xl bg-gradient-to-b from-[var(--brand)]/[0.03] to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none" />
      <div className="relative w-16 h-16 rounded-2xl flex items-center justify-center bg-[var(--bg-secondary)] group-hover:bg-[var(--brand-bg)] transition-all duration-300 group-hover:scale-110">
        {icon}
      </div>
      <div className="text-center">
        <p className="text-[17px] font-bold text-[var(--text-primary)] mb-1">{name}</p>
        <p className="text-[13px] text-[var(--text-tertiary)]">{detail}</p>
      </div>
      <span className="relative mt-auto px-6 py-3 rounded-xl text-[14px] font-semibold bg-[var(--brand)] text-white group-hover:bg-[var(--brand-hover)] transition-all duration-200 shadow-md shadow-[var(--brand)]/20 group-hover:shadow-lg group-hover:shadow-[var(--brand)]/30">
        {buttonLabel}
      </span>
    </a>
  );
}

/* ── Numbered Step Card ─────────────────────────────────────────────────── */
function StepCard({
  step,
  title,
  command,
}: {
  step: number;
  title: string;
  command: string;
}) {
  return (
    <div className="relative flex flex-col">
      {/* Step number badge */}
      <div className="flex items-center gap-3 mb-4">
        <div className="w-8 h-8 rounded-full bg-[var(--brand)] text-white flex items-center justify-center text-[13px] font-bold shadow-md shadow-[var(--brand)]/25">
          {step}
        </div>
        <p className="text-[14px] font-semibold text-[var(--text-primary)]">{title}</p>
      </div>
      <TerminalBlock command={command} />
    </div>
  );
}

/* ── Info callout ───────────────────────────────────────────────────────── */
function InfoCallout({ icon, accent, children }: { icon: React.ReactNode; accent: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 p-5 rounded-xl bg-gradient-to-r from-[var(--brand-bg)] to-transparent border border-[var(--brand)]/10">
      <div className="shrink-0 w-8 h-8 rounded-lg bg-[var(--brand)]/10 flex items-center justify-center text-[var(--brand)]">
        {icon}
      </div>
      <div className="text-[14px] leading-relaxed text-[var(--text-secondary)]">
        <span className="font-semibold text-[var(--brand)]">{accent}</span>{" "}
        {children}
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════ */
/*  Main Component                                                         */
/* ════════════════════════════════════════════════════════════════════════ */
export default function Installation() {
  const { ref, isVisible } = useScrollReveal();
  const [tab, setTab] = useState<Tab>("desktop");

  return (
    <section ref={ref} id="install" className="relative py-24 lg:py-32">
      {/* Subtle background glow */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[500px] rounded-full bg-[var(--brand)] opacity-[0.03] blur-[120px]" />
      </div>

      <div className="relative max-w-[1200px] mx-auto px-6 md:px-8 lg:px-10">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={isVisible ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.65, ease: [0.16, 1, 0.3, 1] }}
          className="text-center max-w-3xl mx-auto mb-14"
        >
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-[var(--brand-bg)] border border-[var(--brand)]/15 mb-6">
            <div className="w-1.5 h-1.5 rounded-full bg-[var(--brand)] animate-pulse" />
            <span className="text-[12px] font-semibold tracking-[0.08em] uppercase text-[var(--brand)]">
              Install
            </span>
          </div>
          <h2 className="text-[clamp(1.75rem,4vw,2.75rem)] font-extrabold leading-[1.1] tracking-[-0.03em] text-[var(--text-primary)] mb-5">
            Get started in{" "}
            <span className="text-[var(--brand)]">seconds.</span>
          </h2>
          <p className="text-[16px] lg:text-[17px] leading-relaxed text-[var(--text-secondary)]">
            Desktop app, CLI, or Helm chart — pick your path and start managing clusters immediately.
          </p>
        </motion.div>

        {/* ── Tab Switcher ───────────────────────────────────────────── */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={isVisible ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6, delay: 0.1, ease: [0.16, 1, 0.3, 1] }}
          className="flex justify-center mb-12"
        >
          <div className="w-full max-w-2xl grid grid-cols-3 gap-2 p-2 rounded-2xl bg-[var(--bg-secondary)] border border-[var(--border-primary)] shadow-sm">
            {tabs.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`relative px-4 sm:px-8 py-3.5 rounded-xl text-[14px] sm:text-[15px] font-semibold transition-all duration-250 ${
                  tab === t.id
                    ? "bg-[var(--brand)] text-white shadow-lg shadow-[var(--brand)]/25"
                    : "text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]"
                }`}
              >
                <span className="flex items-center justify-center gap-2.5">
                  {t.icon}
                  {t.label}
                </span>
              </button>
            ))}
          </div>
        </motion.div>

        {/* ── Tab Content ────────────────────────────────────────────── */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={isVisible ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6, delay: 0.2, ease: [0.16, 1, 0.3, 1] }}
        >
          <AnimatePresence mode="wait">
            {/* ═══════════ DESKTOP TAB ═══════════ */}
            {tab === "desktop" && (
              <motion.div
                key="desktop"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -12 }}
                transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
              >
                {/* OS Cards */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-5 mb-8">
                  <OSCard
                    href="#"
                    name="macOS"
                    detail="Apple Silicon & Intel"
                    buttonLabel="Download .dmg"
                    icon={
                      <svg width="34" height="34" viewBox="0 0 384 512" fill="#A2AAAD">
                        <path d="M318.7 268.7c-.2-36.7 16.4-64.4 50-84.8-18.8-26.9-47.2-41.7-84.7-44.6-35.5-2.8-74.3 20.7-88.5 20.7-15 0-49.4-19.7-76.4-19.7C63.3 141.2 4 184.8 4 273.5q0 39.3 14.4 81.2c12.8 36.7 59 126.7 107.2 125.2 25.2-.6 43-17.9 75.8-17.9 31.8 0 48.3 17.9 76.4 17.9 48.6-.7 90.4-82.5 102.6-119.3-65.2-30.7-61.7-90-61.7-91.9zm-56.6-164.2c27.3-32.4 24.8-61.9 24-72.5-24.1 1.4-52 16.4-67.9 34.9-17.5 19.8-27.8 44.3-25.6 71.9 26.1 2 49.9-11.4 69.5-34.3z" />
                      </svg>
                    }
                  />
                  <OSCard
                    href="#"
                    name="Windows"
                    detail="Windows 10+"
                    buttonLabel="Download .exe"
                    icon={
                      <svg width="32" height="32" viewBox="0 0 88 88" fill="none">
                        <rect x="1" y="1" width="40" height="40" fill="#F25022" />
                        <rect x="47" y="1" width="40" height="40" fill="#7FBA00" />
                        <rect x="1" y="47" width="40" height="40" fill="#00A4EF" />
                        <rect x="47" y="47" width="40" height="40" fill="#FFB900" />
                      </svg>
                    }
                  />
                  <OSCard
                    href="#"
                    name="Linux"
                    detail="AppImage & .deb"
                    buttonLabel="Download"
                    icon={
                      <svg width="30" height="32" viewBox="0 0 256 312" fill="none">
                        <ellipse cx="128" cy="200" rx="72" ry="90" fill="#333" />
                        <ellipse cx="128" cy="215" rx="45" ry="65" fill="#F5F5F5" />
                        <circle cx="128" cy="90" r="52" fill="#333" />
                        <ellipse cx="128" cy="100" rx="36" ry="32" fill="#F5F5F5" />
                        <ellipse cx="114" cy="88" rx="9" ry="11" fill="white" />
                        <circle cx="116" cy="88" r="5" fill="#333" />
                        <ellipse cx="142" cy="88" rx="9" ry="11" fill="white" />
                        <circle cx="140" cy="88" r="5" fill="#333" />
                        <path d="M118 104 L128 118 L138 104 Z" fill="#E8950E" />
                        <ellipse cx="100" cy="290" rx="24" ry="10" fill="#E8950E" />
                        <ellipse cx="156" cy="290" rx="24" ry="10" fill="#E8950E" />
                        <path d="M56 160 Q42 210 60 260 Q70 265 76 250 Q65 210 72 170Z" fill="#333" />
                        <path d="M200 160 Q214 210 196 260 Q186 265 180 250 Q191 210 184 170Z" fill="#333" />
                      </svg>
                    }
                  />
                </div>

                {/* Brew alternative */}
                <div className="p-6 rounded-2xl bg-[var(--bg-secondary)] border border-[var(--border-primary)]">
                  <div className="flex flex-col sm:flex-row sm:items-center gap-4 sm:gap-6">
                    <div className="flex items-center gap-3 shrink-0">
                      <div className="w-10 h-10 rounded-xl bg-[var(--bg-tertiary)] flex items-center justify-center">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-[var(--text-tertiary)]">
                          <path d="M17 8l4 4-4 4" /><path d="M3 12h18" />
                        </svg>
                      </div>
                      <div>
                        <p className="text-[13px] font-semibold text-[var(--text-primary)]">Or via Homebrew</p>
                        <p className="text-[12px] text-[var(--text-tertiary)]">macOS package manager</p>
                      </div>
                    </div>
                    <div className="flex-1">
                      <TerminalBlock command="brew install --cask kubilitics" />
                    </div>
                  </div>
                </div>
              </motion.div>
            )}

            {/* ═══════════ CLI TAB ═══════════ */}
            {tab === "cli" && (
              <motion.div
                key="cli"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -12 }}
                transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
              >
                {/* Hero banner */}
                <div className="relative p-8 lg:p-10 rounded-2xl bg-gradient-to-br from-[#0d1117] to-[#161b22] border border-white/[0.06] mb-8 overflow-hidden">
                  <div className="absolute top-0 right-0 w-[300px] h-[300px] bg-emerald-500/5 rounded-full blur-[100px] pointer-events-none" />
                  <div className="relative flex flex-col lg:flex-row lg:items-center gap-6 lg:gap-10">
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-4">
                        <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
                          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#34d399" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="4 17 10 11 4 5" /><line x1="12" y1="19" x2="20" y2="19" />
                          </svg>
                        </div>
                        <div>
                          <h3 className="text-xl font-bold text-white">kcli</h3>
                          <p className="text-[13px] text-white/40">AI-Powered kubectl Replacement</p>
                        </div>
                      </div>
                      <p className="text-[15px] leading-relaxed text-white/60 max-w-lg">
                        Natural language queries, intelligent auto-completions, and AI-powered insights. Drop-in replacement for kubectl.
                      </p>
                    </div>
                    <div className="lg:w-[420px] shrink-0">
                      <TerminalBlock command="curl -fsSL https://kubilitics.com/install.sh | sh" label="Quick install" />
                    </div>
                  </div>
                </div>

                {/* Package manager grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* Homebrew */}
                  <div className="p-6 rounded-2xl bg-[var(--bg-card)] border border-[var(--border-primary)] hover:border-[var(--border-secondary)] transition-colors">
                    <div className="flex items-center gap-3 mb-5">
                      <div className="w-10 h-10 rounded-xl bg-amber-500/10 flex items-center justify-center">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M17 8l4 4-4 4" /><path d="M3 12h18" />
                        </svg>
                      </div>
                      <div>
                        <p className="text-[15px] font-semibold text-[var(--text-primary)]">Homebrew</p>
                        <p className="text-[12px] text-[var(--text-tertiary)]">macOS & Linux</p>
                      </div>
                    </div>
                    <TerminalMulti
                      commands={[
                        { cmd: "brew tap kubilitics/tap" },
                        { cmd: "brew install kubilitics/tap/kcli" },
                      ]}
                    />
                  </div>

                  {/* Scoop */}
                  <div className="p-6 rounded-2xl bg-[var(--bg-card)] border border-[var(--border-primary)] hover:border-[var(--border-secondary)] transition-colors">
                    <div className="flex items-center gap-3 mb-5">
                      <div className="w-10 h-10 rounded-xl bg-sky-500/10 flex items-center justify-center">
                        <svg width="20" height="20" viewBox="0 0 88 88" fill="none">
                          <rect x="1" y="1" width="40" height="40" fill="#F25022" rx="2" />
                          <rect x="47" y="1" width="40" height="40" fill="#7FBA00" rx="2" />
                          <rect x="1" y="47" width="40" height="40" fill="#00A4EF" rx="2" />
                          <rect x="47" y="47" width="40" height="40" fill="#FFB900" rx="2" />
                        </svg>
                      </div>
                      <div>
                        <p className="text-[15px] font-semibold text-[var(--text-primary)]">Scoop</p>
                        <p className="text-[12px] text-[var(--text-tertiary)]">Windows</p>
                      </div>
                    </div>
                    <TerminalMulti
                      commands={[
                        { cmd: "scoop bucket add kubilitics https://github.com/kubilitics/scoop-bucket" },
                        { cmd: "scoop install kubilitics/kcli" },
                      ]}
                    />
                  </div>

                  {/* kubectl plugin */}
                  <div className="p-6 rounded-2xl bg-[var(--bg-card)] border border-[var(--border-primary)] hover:border-[var(--border-secondary)] transition-colors">
                    <div className="flex items-center gap-3 mb-5">
                      <div className="w-10 h-10 rounded-xl bg-blue-500/10 flex items-center justify-center">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                          <circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" />
                        </svg>
                      </div>
                      <div>
                        <p className="text-[15px] font-semibold text-[var(--text-primary)]">kubectl Plugin</p>
                        <p className="text-[12px] text-[var(--text-tertiary)]">Via Krew</p>
                      </div>
                    </div>
                    <TerminalMulti
                      commands={[
                        { cmd: "kubectl krew install kubilitics" },
                        { cmd: "kubectl kubilitics dashboard" },
                      ]}
                    />
                  </div>

                  {/* Docker */}
                  <div className="p-6 rounded-2xl bg-[var(--bg-card)] border border-[var(--border-primary)] hover:border-[var(--border-secondary)] transition-colors">
                    <div className="flex items-center gap-3 mb-5">
                      <div className="w-10 h-10 rounded-xl bg-cyan-500/10 flex items-center justify-center">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#06b6d4" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M12 2L3 7v10l9 5 9-5V7l-9-5z" /><path d="M12 22V12" /><path d="M3 7l9 5 9-5" />
                        </svg>
                      </div>
                      <div>
                        <p className="text-[15px] font-semibold text-[var(--text-primary)]">Docker</p>
                        <p className="text-[12px] text-[var(--text-tertiary)]">Container image</p>
                      </div>
                    </div>
                    <TerminalBlock command="docker run -p 8080:8080 ghcr.io/kubilitics/kubilitics-backend:latest" />
                  </div>
                </div>

                {/* Verify callout */}
                <div className="mt-8">
                  <InfoCallout
                    accent="Verify:"
                    icon={
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    }
                  >
                    Run <code className="px-2 py-0.5 rounded-md bg-[var(--bg-secondary)] text-[13px] font-mono font-medium text-[var(--text-primary)]">kcli version</code> to confirm installation. Set up shell completions with <code className="px-2 py-0.5 rounded-md bg-[var(--bg-secondary)] text-[13px] font-mono font-medium text-[var(--text-primary)]">kcli completion bash</code>.
                  </InfoCallout>
                </div>
              </motion.div>
            )}

            {/* ═══════════ IN-CLUSTER TAB ═══════════ */}
            {tab === "cluster" && (
              <motion.div
                key="cluster"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -12 }}
                transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
              >
                {/* Header card */}
                <div className="relative p-8 lg:p-10 rounded-2xl bg-gradient-to-br from-[var(--brand-bg)] via-[var(--bg-card)] to-[var(--bg-card)] border border-[var(--brand)]/10 mb-8 overflow-hidden">
                  <div className="absolute top-0 right-0 w-[300px] h-[300px] bg-[var(--brand)]/5 rounded-full blur-[100px] pointer-events-none" />
                  <div className="relative flex items-start gap-4">
                    <div className="w-14 h-14 rounded-2xl bg-[var(--brand)]/10 border border-[var(--brand)]/20 flex items-center justify-center text-[var(--brand)] shrink-0">
                      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M12 2L3 7v10l9 5 9-5V7l-9-5z" />
                      </svg>
                    </div>
                    <div>
                      <h3 className="text-xl font-bold text-[var(--text-primary)] mb-2">In-Cluster Deployment</h3>
                      <p className="text-[15px] leading-relaxed text-[var(--text-secondary)] max-w-2xl">
                        Deploy Kubilitics inside your Kubernetes cluster with Helm. Your entire team gets browser-based access with RBAC-scoped views.
                      </p>
                    </div>
                  </div>
                </div>

                {/* Steps */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
                  <StepCard
                    step={1}
                    title="Add the Helm repo"
                    command="helm repo add kubilitics https://charts.kubilitics.com"
                  />
                  <StepCard
                    step={2}
                    title="Install the chart"
                    command="helm install kubilitics kubilitics/kubilitics -n kubilitics --create-namespace"
                  />
                  <StepCard
                    step={3}
                    title="Access the dashboard"
                    command="kubectl port-forward svc/kubilitics 8080:80 -n kubilitics"
                  />
                </div>

                {/* Callout */}
                <InfoCallout
                  accent="Team access:"
                  icon={
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 00-3-3.87" /><path d="M16 3.13a4 4 0 010 7.75" />
                    </svg>
                  }
                >
                  Once deployed, everyone on your team can access Kubilitics through the browser. Supports RBAC-scoped views, SSO integration, and custom ingress configuration.
                </InfoCallout>

                {/* K8s compatibility */}
                <div className="mt-8 text-center">
                  <p className="text-[12px] font-semibold text-[var(--text-tertiary)] uppercase tracking-wider mb-4">
                    Works with every Kubernetes distribution
                  </p>
                  <div className="flex flex-wrap items-center justify-center gap-2.5">
                    {["EKS", "GKE", "AKS", "k3s", "kind", "Minikube", "Talos", "OpenShift"].map((k) => (
                      <span
                        key={k}
                        className="px-4 py-2 rounded-xl bg-[var(--bg-card)] border border-[var(--border-primary)] text-[13px] font-semibold text-[var(--text-tertiary)] hover:border-[var(--brand)]/20 hover:text-[var(--text-secondary)] transition-colors"
                      >
                        {k}
                      </span>
                    ))}
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      </div>
    </section>
  );
}
