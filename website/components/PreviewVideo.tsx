"use client";

import { motion } from "framer-motion";
import { useScrollReveal } from "@/hooks/useScrollReveal";

export default function PreviewVideo() {
  const { ref, isVisible } = useScrollReveal(0.05);

  return (
    <section ref={ref} id="preview" className="relative py-8 lg:py-12 overflow-hidden">
      <div className="max-w-[1000px] mx-auto px-6 md:px-8 lg:px-10">
        <motion.div
          initial={{ opacity: 0, y: 40, scale: 0.97 }}
          animate={isVisible ? { opacity: 1, y: 0, scale: 1 } : {}}
          transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
          className="relative"
        >
          {/* Outer glow — contained within overflow-hidden parent */}
          <div className="absolute inset-0 -m-4 rounded-[2rem] bg-[var(--brand)] opacity-[0.04] blur-[60px] pointer-events-none" />
          <div className="absolute inset-0 -m-1 rounded-3xl bg-[var(--brand)] opacity-[0.06] blur-2xl pointer-events-none" />

          {/* Window container */}
          <div className="relative rounded-2xl overflow-hidden border border-[var(--border-primary)] bg-[var(--bg-card)] shadow-2xl shadow-black/10 dark:shadow-black/50 video-reflection">
            {/* Window chrome — premium gradient */}
            <div className="flex items-center gap-2 px-5 py-3.5 border-b border-[var(--border-primary)] window-chrome">
              <div className="flex items-center gap-2">
                <span className="w-[13px] h-[13px] rounded-full bg-[#FF5F57] shadow-inner" />
                <span className="w-[13px] h-[13px] rounded-full bg-[#FEBC2E] shadow-inner" />
                <span className="w-[13px] h-[13px] rounded-full bg-[#28C840] shadow-inner" />
              </div>
              <div className="flex-1 flex justify-center">
                <div className="flex items-center gap-2 px-5 py-1.5 rounded-lg bg-[var(--bg-tertiary)] border border-[var(--border-primary)]">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-[var(--text-tertiary)] opacity-60">
                    <rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0110 0v4" />
                  </svg>
                  <span className="text-[11px] font-medium text-[var(--text-tertiary)] tracking-wide">kubilitics.local</span>
                </div>
              </div>
              <div className="w-[60px]" />
            </div>

            {/* Video area */}
            <div className="relative aspect-[16/9] bg-[#0b0e14] overflow-hidden">
              <video
                autoPlay
                loop
                muted
                playsInline
                className="w-full h-full object-cover"
              >
                <source src="/preview-demo.webm" type="video/webm" />
                <source src="/preview-demo.mp4" type="video/mp4" />
              </video>

              {/* Subtle vignette overlay for cinematic feel */}
              <div className="absolute inset-0 pointer-events-none" style={{
                background: "radial-gradient(ellipse at center, transparent 60%, rgba(0,0,0,0.15) 100%)"
              }} />
            </div>
          </div>

          {/* Bottom highlight bar */}
          <div className="absolute -bottom-px left-[10%] right-[10%] h-px bg-gradient-to-r from-transparent via-[var(--brand)] to-transparent opacity-20" />
        </motion.div>

        {/* Caption */}
        <motion.p
          initial={{ opacity: 0 }}
          animate={isVisible ? { opacity: 1 } : {}}
          transition={{ duration: 0.6, delay: 0.5 }}
          className="mt-6 text-center text-[14px] text-[var(--text-tertiary)] max-w-3xl mx-auto leading-relaxed"
        >
          Real-time cluster management — Connect, Dashboard, Fleet, Workloads, Pods, Deployments, Nodes, and Add-ons.
        </motion.p>
      </div>
    </section>
  );
}
