/**
 * ThemeToggle — Prominent, animated theme toggle for the header.
 *
 * Features:
 * - Sun/Moon icon toggle with smooth Framer Motion crossfade + rotation
 * - Click to quick-toggle between light/dark
 * - Long-press or right-click opens dropdown with system option
 * - Persists preference to localStorage via themeStore
 * - Respects system preference as default
 * - Accessible: aria-label, keyboard support, focus ring
 * - Uses design tokens from src/tokens/colors.css
 *
 * TASK-CORE-003: Complete Dark Mode
 */
import { useState, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Moon, Sun, Monitor } from 'lucide-react';
import { useThemeStore, type Theme } from '@/stores/themeStore';
import { cn } from '@/lib/utils';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';

/* ─── Animation variants ─── */
const iconVariants = {
  initial: { opacity: 0, rotate: -90, scale: 0.5 },
  animate: {
    opacity: 1,
    rotate: 0,
    scale: 1,
    transition: {
      type: 'spring',
      stiffness: 300,
      damping: 20,
      mass: 0.8,
    },
  },
  exit: {
    opacity: 0,
    rotate: 90,
    scale: 0.5,
    transition: { duration: 0.15, ease: 'easeIn' },
  },
};

const rayVariants = {
  dark: { opacity: 0, scale: 0.6, transition: { duration: 0.15 } },
  light: {
    opacity: 1,
    scale: 1,
    transition: { type: 'spring', stiffness: 250, damping: 18, delay: 0.05 },
  },
};

const themeOptions: { value: Theme; label: string; icon: typeof Sun; shortcut?: string }[] = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'System', icon: Monitor },
];

function ThemeLabel(theme: Theme, resolvedTheme: 'light' | 'dark'): string {
  if (theme === 'system') {
    return `System (${resolvedTheme === 'dark' ? 'Dark' : 'Light'})`;
  }
  return theme === 'dark' ? 'Dark' : 'Light';
}

export function ThemeToggle() {
  const { theme, setTheme, resolvedTheme, toggleTheme } = useThemeStore();
  const effectiveTheme = theme === 'system' ? resolvedTheme : theme;
  const isDark = effectiveTheme === 'dark';
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const didLongPress = useRef(false);

  const handleQuickToggle = useCallback(() => {
    if (didLongPress.current) {
      didLongPress.current = false;
      return;
    }
    toggleTheme();
  }, [toggleTheme]);

  const handlePointerDown = useCallback(() => {
    didLongPress.current = false;
    longPressTimer.current = setTimeout(() => {
      didLongPress.current = true;
      setDropdownOpen(true);
    }, 500);
  }, []);

  const handlePointerUp = useCallback(() => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }, []);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setDropdownOpen(true);
  }, []);

  return (
    <DropdownMenu open={dropdownOpen} onOpenChange={setDropdownOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <motion.button
              type="button"
              onClick={handleQuickToggle}
              onPointerDown={handlePointerDown}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerUp}
              onContextMenu={handleContextMenu}
              className={cn(
                'relative h-10 w-10 rounded-xl',
                'inline-flex items-center justify-center',
                'border border-slate-200/50 dark:border-slate-700/50',
                'bg-white/60 dark:bg-slate-800/60',
                'hover:bg-slate-100/80 dark:hover:bg-slate-700/60',
                'hover:border-slate-300/60 dark:hover:border-slate-600/60',
                'hover:shadow-sm dark:hover:shadow-[0_2px_8px_rgba(0,0,0,0.3)]',
                'active:scale-[0.95]',
                'transition-[background-color,border-color,box-shadow] duration-200 ease-out',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20',
                'select-none'
              )}
              whileTap={{ scale: 0.92 }}
              aria-label={`Theme: ${ThemeLabel(theme, resolvedTheme)}. Click to toggle, right-click for options.`}
              data-testid="theme-toggle"
            >
              {/* Ambient glow ring */}
              <motion.div
                className="absolute inset-0 rounded-xl"
                animate={{
                  boxShadow: isDark
                    ? '0 0 12px 2px hsl(217 91% 60% / 0.08)'
                    : '0 0 12px 2px hsl(38 92% 50% / 0.08)',
                }}
                transition={{ duration: 0.4 }}
              />

              {/* Icon container with crossfade */}
              <div className="relative h-5 w-5">
                <AnimatePresence mode="wait" initial={false}>
                  {isDark ? (
                    <motion.div
                      key="moon"
                      variants={iconVariants}
                      initial="initial"
                      animate="animate"
                      exit="exit"
                      className="absolute inset-0 flex items-center justify-center"
                    >
                      <Moon className="h-[18px] w-[18px] text-blue-400" strokeWidth={2} />
                    </motion.div>
                  ) : (
                    <motion.div
                      key="sun"
                      variants={iconVariants}
                      initial="initial"
                      animate="animate"
                      exit="exit"
                      className="absolute inset-0 flex items-center justify-center"
                    >
                      {/* Sun core */}
                      <Sun className="h-[18px] w-[18px] text-amber-500" strokeWidth={2} />
                      {/* Animated rays overlay */}
                      <motion.div
                        className="absolute inset-0 flex items-center justify-center"
                        variants={rayVariants}
                        initial="dark"
                        animate="light"
                      >
                        <div className="absolute h-[26px] w-[26px] rounded-full border-[1.5px] border-amber-400/20" />
                      </motion.div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {/* System indicator dot */}
              {theme === 'system' && (
                <motion.div
                  initial={{ scale: 0, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0, opacity: 0 }}
                  className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-primary border-2 border-white dark:border-slate-800"
                  title="Following system preference"
                />
              )}
            </motion.button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom" sideOffset={8}>
          <div className="text-center">
            <div className="font-medium">{ThemeLabel(theme, resolvedTheme)}</div>
            <div className="text-[10px] text-muted-foreground mt-0.5">
              Click to toggle &middot; Right-click for options
            </div>
          </div>
        </TooltipContent>
      </Tooltip>

      <DropdownMenuContent align="end" className="min-w-[180px] p-1.5 rounded-xl">
        <div className="px-2.5 py-1.5 mb-1">
          <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-[0.12em]">
            Appearance
          </p>
        </div>
        {themeOptions.map(({ value, label, icon: Icon }) => {
          const isActive = theme === value;
          return (
            <DropdownMenuItem
              key={value}
              onClick={() => setTheme(value)}
              className={cn(
                'flex items-center gap-3 py-2.5 px-3 rounded-lg cursor-pointer transition-colors',
                isActive && 'bg-primary/8 text-primary dark:bg-primary/12'
              )}
            >
              <div
                className={cn(
                  'h-7 w-7 rounded-lg flex items-center justify-center transition-colors',
                  isActive
                    ? 'bg-primary/10 dark:bg-primary/20'
                    : 'bg-slate-100 dark:bg-slate-800'
                )}
              >
                <Icon
                  className={cn(
                    'h-3.5 w-3.5',
                    isActive ? 'text-primary' : 'text-muted-foreground'
                  )}
                />
              </div>
              <span className="flex-1 text-sm font-medium">{label}</span>
              {isActive && (
                <motion.div
                  layoutId="theme-check"
                  className="h-1.5 w-1.5 rounded-full bg-primary"
                  transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                />
              )}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
