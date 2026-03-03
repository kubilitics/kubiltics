import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-inter)", "system-ui", "sans-serif"],
        mono: ["var(--font-geist-mono)", "ui-monospace", "SFMono-Regular", "monospace"],
      },
      colors: {
        surface: {
          0: "#06080C",
          1: "#0B0E14",
          2: "#10141C",
          3: "#151B26",
          border: "#1D2535",
          "border-2": "#263043",
        },
        ink: {
          DEFAULT: "#EEF2F7",
          2: "#9BAABE",
          3: "#5A6880",
          4: "#323D4F",
        },
        brand: {
          DEFAULT: "#4F7BF7",
          dim: "#3560D8",
          muted: "rgba(79,123,247,0.12)",
          glow: "rgba(79,123,247,0.18)",
        },
        teal: {
          DEFAULT: "#2FC8B8",
          muted: "rgba(47,200,184,0.12)",
        },
        violet: {
          DEFAULT: "#9B7CF4",
          muted: "rgba(155,124,244,0.12)",
        },
        amber: {
          DEFAULT: "#F5A623",
          muted: "rgba(245,166,35,0.12)",
        },
        green: {
          DEFAULT: "#2FD07D",
          muted: "rgba(47,208,125,0.12)",
        },
      },
      spacing: {
        "18": "4.5rem",
        "22": "5.5rem",
        "30": "7.5rem",
      },
      borderRadius: {
        "2xl": "1rem",
        "3xl": "1.5rem",
      },
      animation: {
        "fade-up": "fadeUp 0.6s cubic-bezier(0.16,1,0.3,1) forwards",
        "fade-in": "fadeIn 0.8s ease forwards",
        "pulse-slow": "pulse 4s ease-in-out infinite",
      },
      keyframes: {
        fadeUp: {
          from: { opacity: "0", transform: "translateY(20px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        fadeIn: {
          from: { opacity: "0" },
          to: { opacity: "1" },
        },
      },
      backgroundImage: {
        "dot-grid":
          "radial-gradient(circle, #1D2535 1px, transparent 1px)",
        "gradient-radial":
          "radial-gradient(var(--tw-gradient-stops))",
      },
      backgroundSize: {
        "dot-grid": "28px 28px",
      },
      boxShadow: {
        "glow-sm": "0 0 20px rgba(79,123,247,0.15)",
        "glow-md": "0 0 40px rgba(79,123,247,0.22)",
        "card": "0 1px 0 rgba(255,255,255,0.04), 0 8px 32px rgba(0,0,0,0.5)",
        "card-hover": "0 1px 0 rgba(255,255,255,0.06), 0 16px 48px rgba(0,0,0,0.6)",
      },
    },
  },
  plugins: [],
};

export default config;
