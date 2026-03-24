/* eslint-disable react-refresh/only-export-components */
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
 * All visual styles live in index.css (global stylesheet) — NOT in an
 * inline <style> tag — to guarantee they are parsed before the first
 * toast renders. This is critical for Tauri's WKWebView where component-
 * injected <style> tags can race with toast rendering.
 */
import { Toaster as Sonner, toast as sonnerToast } from "sonner";
import { useThemeStore } from "@/stores/themeStore";

type ToasterProps = React.ComponentProps<typeof Sonner>;

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme, resolvedTheme } = useThemeStore();
  const effectiveTheme = theme === 'system' ? resolvedTheme : theme;
  return (
    <Sonner
      position="bottom-right"
      theme={effectiveTheme}
      offset={24}
      gap={8}
      visibleToasts={1}
      closeButton
      richColors={false}
      toastOptions={{
        duration: 2500,
        classNames: {
          toast: "apple-toast",
        },
      }}
      style={{ zIndex: 999999999 }}
      {...props}
    />
  );
};

/**
 * Deduplicated toast wrapper — prevents stacking of identical messages.
 *
 * Uses the message text as a stable ID so firing the same toast multiple
 * times (e.g., from WebSocket reconnect + auto-connect + notification
 * formatter) only shows one. Errors get a longer duration (4s vs 2.5s).
 */
const toast = {
  success: (message: string, opts?: Parameters<typeof sonnerToast.success>[1]) =>
    sonnerToast.success(message, { id: `s:${message}`, ...opts }),
  error: (message: string, opts?: Parameters<typeof sonnerToast.error>[1]) =>
    sonnerToast.error(message, { id: `e:${message}`, duration: 4000, ...opts }),
  warning: (message: string, opts?: Parameters<typeof sonnerToast.warning>[1]) =>
    sonnerToast.warning(message, { id: `w:${message}`, duration: 3500, ...opts }),
  info: (message: string, opts?: Parameters<typeof sonnerToast.info>[1]) =>
    sonnerToast.info(message, { id: `i:${message}`, ...opts }),
  message: (message: string, opts?: Parameters<typeof sonnerToast>[1]) =>
    sonnerToast(message, { id: `m:${message}`, ...opts }),
  dismiss: sonnerToast.dismiss,
  loading: (message: string, opts?: Parameters<typeof sonnerToast.loading>[1]) =>
    sonnerToast.loading(message, { id: `l:${message}`, ...opts }),
  promise: sonnerToast.promise,
  custom: sonnerToast.custom,
};

export { Toaster, toast };
