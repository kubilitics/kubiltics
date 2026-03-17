"use client";

import { motion } from "framer-motion";
import { useScrollReveal } from "@/hooks/useScrollReveal";

export default function FinalCTA() {
  const { ref, isVisible } = useScrollReveal();

  return (
    <section ref={ref} id="cta" className="relative py-32 lg:py-40 overflow-hidden">
      {/* Background glow */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[400px] rounded-full bg-[var(--brand)] opacity-[0.05] blur-[100px]" />
      </div>

      <div className="relative max-w-[1200px] mx-auto px-6 md:px-8 lg:px-10 text-center">
        <motion.div
          initial={{ opacity: 0, y: 32 }}
          animate={isVisible ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
        >
          <h2 className="text-[clamp(2rem,5.5vw,3.5rem)] font-extrabold leading-[1.08] tracking-[-0.035em] text-[var(--text-primary)] mb-6">
            Build once.
            <br />
            <span className="text-[var(--text-tertiary)]">Build for life.</span>
          </h2>
          <p className="text-lg leading-relaxed text-[var(--text-secondary)] mb-10 max-w-3xl mx-auto">
            Start managing your Kubernetes clusters with confidence.
            Download the desktop app or deploy in your cluster — free.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
            <a
              href="#install"
              className="group inline-flex items-center gap-2.5 px-7 py-4 rounded-2xl bg-[var(--brand)] text-white text-[15px] font-semibold hover:bg-[var(--brand-hover)] active:scale-[0.98] transition-all duration-200 shadow-lg shadow-blue-500/20"
            >
              Get Started Free
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="group-hover:translate-x-0.5 transition-transform duration-200">
                <path d="M3 7h8M7.5 3.5L11 7l-3.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </a>
            <a
              href="#features"
              className="inline-flex items-center gap-2.5 px-7 py-4 rounded-2xl bg-[var(--bg-card)] border border-[var(--border-primary)] text-[var(--text-primary)] text-[15px] font-semibold hover:border-[var(--border-secondary)] hover:bg-[var(--bg-elevated)] active:scale-[0.98] transition-all duration-200"
            >
              Explore Features
            </a>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
