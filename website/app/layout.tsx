import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { ThemeProvider } from "@/components/ThemeProvider";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
  weight: ["300", "400", "500", "600", "700", "800"],
});

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#FFFFFF" },
    { media: "(prefers-color-scheme: dark)", color: "#030712" },
  ],
  width: "device-width",
  initialScale: 1,
};

export const metadata: Metadata = {
  title: "Kubilitics — Unified Kubernetes Intelligence",
  description:
    "The complete Kubernetes management platform. Visualize clusters, analyze dependencies, manage workloads. Download the desktop app or deploy in-cluster for your team.",
  keywords: [
    "Kubernetes",
    "K8s",
    "cluster management",
    "Kubernetes dashboard",
    "Kubernetes desktop app",
    "workload management",
    "multi-cluster",
    "platform engineering",
  ],
  authors: [{ name: "Kubilitics" }],
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: "/apple-touch-icon.png",
  },
  openGraph: {
    title: "Kubilitics — Unified Kubernetes Intelligence",
    description:
      "The complete Kubernetes management platform. Build once, build for life.",
    url: "https://kubilitics.com",
    siteName: "Kubilitics",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Kubilitics — Unified Kubernetes Intelligence",
    description:
      "The complete Kubernetes management platform. Build once, build for life.",
  },
  robots: { index: true, follow: true },
  metadataBase: new URL("https://kubilitics.com"),
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={inter.variable} suppressHydrationWarning>
      <body className="font-sans antialiased">
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
