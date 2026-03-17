"use client";

import Image from "next/image";
import Link from "next/link";

const groups = [
  {
    title: "Product",
    links: [
      { label: "Features", href: "#features" },
      { label: "How It Works", href: "#how-it-works" },
      { label: "Install", href: "#install" },
      { label: "Security", href: "#security" },
    ],
  },
  {
    title: "Resources",
    links: [
      { label: "Documentation", href: "#" },
      { label: "Changelog", href: "#" },
      { label: "Support", href: "#" },
    ],
  },
  {
    title: "Legal",
    links: [
      { label: "Privacy Policy", href: "#" },
      { label: "Terms of Service", href: "#" },
    ],
  },
];

export default function Footer() {
  return (
    <footer className="relative bg-[var(--bg-secondary)] border-t border-[var(--border-primary)]">
      <div className="max-w-[1200px] mx-auto px-6 md:px-8 lg:px-10 py-16">
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-16 mb-14">
          {/* Brand */}
          <div className="lg:col-span-2">
            <Link href="/" className="flex items-center gap-3 w-fit mb-5 group">
              <Image src="/brand/logo-mark-rounded.png" alt="Kubilitics" width={30} height={30} className="rounded-md logo-glow" />
              <span className="text-[16px] font-bold tracking-[-0.02em] text-[var(--text-primary)]">Kubilitics</span>
            </Link>
            <p className="text-[14px] leading-[1.7] text-[var(--text-tertiary)] max-w-xs">
              Unified Kubernetes Intelligence.
              <br />
              Build once, build for life.
            </p>
          </div>

          {/* Links */}
          {groups.map((g) => (
            <div key={g.title}>
              <p className="text-[11px] font-semibold tracking-[0.1em] uppercase text-[var(--text-tertiary)] mb-4">
                {g.title}
              </p>
              <ul className="flex flex-col gap-3">
                {g.links.map((l) => (
                  <li key={l.label}>
                    <a
                      href={l.href}
                      className="text-[14px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors duration-200"
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
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pt-8 border-t border-[var(--border-primary)]">
          <p className="text-[12px] text-[var(--text-tertiary)]">
            &copy; {new Date().getFullYear()} Kubilitics. All rights reserved.
          </p>
          <p className="text-[12px] text-[var(--text-tertiary)]">
            Made for engineers who care about their clusters.
          </p>
        </div>
      </div>
    </footer>
  );
}
