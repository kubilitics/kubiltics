import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
  weight: ["300", "400", "500", "600", "700"],
});

export const viewport: Viewport = {
  themeColor: "#06080C",
  width: "device-width",
  initialScale: 1,
};

export const metadata: Metadata = {
  title: "Kubilitics — Kubernetes Relationship Intelligence Engine",
  description:
    "Kubilitics maps every relationship in your Kubernetes cluster — Deployments, Services, ConfigMaps, PVCs, RBAC — and tells you what breaks if you change anything.",
  keywords: [
    "Kubernetes",
    "K8s",
    "dependency graph",
    "relationship visualization",
    "impact analysis",
    "cluster management",
    "platform engineering",
    "DevOps",
  ],
  authors: [{ name: "Kubilitics" }],
  openGraph: {
    title: "Kubilitics — Kubernetes Relationship Intelligence Engine",
    description:
      "Map every Kubernetes dependency. Understand impact before making changes. Built for production engineering teams.",
    url: "https://kubilitics.io",
    siteName: "Kubilitics",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Kubilitics — Kubernetes Relationship Intelligence Engine",
    description:
      "Map every Kubernetes dependency. Understand impact before making changes.",
  },
  robots: { index: true, follow: true },
  metadataBase: new URL("https://kubilitics.io"),
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${inter.variable} dark`}>
      <body className="bg-[#06080C] text-[#EEF2F7] antialiased selection:bg-brand-muted">
        {children}
      </body>
    </html>
  );
}
