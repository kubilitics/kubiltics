/**
 * Apple-style toast notifications powered by Sonner.
 *
 * Design language: macOS/iOS system notifications
 *  - Bottom-right positioning (macOS notification centre)
 *  - SF Pro-equivalent font stack (system-ui)
 *  - Vibrancy glass: solid bg with subtle shadow (WebKit-safe)
 *  - No visible border — pure layered shadow
 *  - Coloured leading stripe per semantic type (success/error/warning/info)
 *  - Compact, information-dense layout
 *  - Spring-in, slide-right-out animation
 *
 * NOTE: Removed next-themes dependency. The previous `useTheme()` call
 * required a ThemeProvider that was never added to the app tree.
 * This caused silent failures in Tauri's WKWebView where the Toaster
 * could fail to render. Also removed backdrop-filter (known WKWebView
 * rendering bug that can make fixed-position elements invisible).
 */
import { Toaster as Sonner, toast } from "sonner";
import { useThemeStore } from "@/stores/themeStore";

type ToasterProps = React.ComponentProps<typeof Sonner>;

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme, resolvedTheme } = useThemeStore();
  const effectiveTheme = theme === 'system' ? resolvedTheme : theme;
  return (
    <>
      {/* Per-type accent stripe + dark mode overrides */}
      <style>{`
        /* ── Base toast ─────────────────────────────────────────────── */
        [data-sonner-toaster] [data-sonner-toast] {
          font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display",
            "SF Pro Text", "Helvetica Neue", system-ui, sans-serif !important;
          border: none !important;
          box-shadow:
            0 0 0 0.5px rgba(0, 0, 0, 0.06),
            0 4px 16px rgba(0, 0, 0, 0.10),
            0 12px 36px rgba(0, 0, 0, 0.08) !important;
          border-radius: 14px !important;
          padding: 13px 16px 13px 18px !important;
          background: rgba(255, 255, 255, 0.97) !important;
          min-width: 300px !important;
          max-width: 380px !important;
          position: relative !important;
          overflow: hidden !important;
        }

        /* ── Coloured left accent stripe ─────────────────────────── */
        [data-sonner-toaster] [data-sonner-toast]::before {
          content: "";
          position: absolute;
          left: 0;
          top: 0;
          bottom: 0;
          width: 4px;
          border-radius: 14px 0 0 14px;
        }
        [data-sonner-toaster] [data-sonner-toast][data-type="success"]::before {
          background: #34C759;
        }
        [data-sonner-toaster] [data-sonner-toast][data-type="error"]::before {
          background: #FF3B30;
        }
        [data-sonner-toaster] [data-sonner-toast][data-type="warning"]::before {
          background: #FF9500;
        }
        [data-sonner-toaster] [data-sonner-toast][data-type="info"]::before {
          background: #007AFF;
        }
        /* default / loading */
        [data-sonner-toaster] [data-sonner-toast]:not([data-type])::before,
        [data-sonner-toaster] [data-sonner-toast][data-type="loading"]::before {
          background: #8E8E93;
        }

        /* ── Title ───────────────────────────────────────────────── */
        [data-sonner-toaster] [data-sonner-toast] [data-title] {
          font-size: 13.5px !important;
          font-weight: 600 !important;
          letter-spacing: -0.1px !important;
          color: #1C1C1E !important;
          line-height: 1.35 !important;
        }

        /* ── Description ─────────────────────────────────────────── */
        [data-sonner-toaster] [data-sonner-toast] [data-description] {
          font-size: 12px !important;
          font-weight: 400 !important;
          color: #6C6C70 !important;
          line-height: 1.45 !important;
          margin-top: 2px !important;
        }

        /* ── Icon (SF-symbol-like dot badge colours) ─────────────── */
        [data-sonner-toaster] [data-sonner-toast][data-type="success"] [data-icon] svg {
          color: #34C759 !important;
        }
        [data-sonner-toaster] [data-sonner-toast][data-type="error"] [data-icon] svg {
          color: #FF3B30 !important;
        }
        [data-sonner-toaster] [data-sonner-toast][data-type="warning"] [data-icon] svg {
          color: #FF9500 !important;
        }
        [data-sonner-toaster] [data-sonner-toast][data-type="info"] [data-icon] svg {
          color: #007AFF !important;
        }

        /* ── Close button ────────────────────────────────────────── */
        [data-sonner-toaster] [data-sonner-toast] [data-close-button] {
          background: rgba(0, 0, 0, 0.06) !important;
          border: none !important;
          border-radius: 50% !important;
          opacity: 0;
          transition: opacity 0.15s ease !important;
        }
        [data-sonner-toaster] [data-sonner-toast]:hover [data-close-button] {
          opacity: 1 !important;
        }
        [data-sonner-toaster] [data-sonner-toast] [data-close-button]:hover {
          background: rgba(0, 0, 0, 0.12) !important;
        }

        /* ── Dark mode overrides ─────────────────────────────────── */
        .dark [data-sonner-toaster] [data-sonner-toast] {
          background: rgba(28, 28, 30, 0.97) !important;
          box-shadow:
            0 0 0 0.5px rgba(255, 255, 255, 0.08),
            0 4px 16px rgba(0, 0, 0, 0.40),
            0 12px 36px rgba(0, 0, 0, 0.30) !important;
        }
        .dark [data-sonner-toaster] [data-sonner-toast] [data-title] {
          color: #F2F2F7 !important;
        }
        .dark [data-sonner-toaster] [data-sonner-toast] [data-description] {
          color: #8E8E93 !important;
        }
        .dark [data-sonner-toaster] [data-sonner-toast] [data-close-button] {
          background: rgba(255, 255, 255, 0.08) !important;
        }
        .dark [data-sonner-toaster] [data-sonner-toast] [data-close-button]:hover {
          background: rgba(255, 255, 255, 0.14) !important;
        }

        /* ── Ensure toaster portal is always visible (Tauri fix) ── */
        [data-sonner-toaster] {
          z-index: 999999999 !important;
          pointer-events: auto !important;
        }
      `}</style>

      <Sonner
        position="bottom-right"
        theme={effectiveTheme}
        offset={24}
        gap={8}
        visibleToasts={3}
        closeButton
        richColors={false}
        toastOptions={{
          duration: 3500,
          classNames: {
            toast: "apple-toast",
          },
        }}
        style={{ zIndex: 999999999 }}
        {...props}
      />
    </>
  );
};

export { Toaster, toast };
