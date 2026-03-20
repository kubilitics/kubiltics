import { useCallback } from 'react';

/**
 * SkipNavigation renders a visually hidden link that becomes visible on focus.
 * It allows keyboard users to skip past repeated navigation and jump straight
 * to #main-content.  The component is intended to be the very first focusable
 * element in the DOM (rendered before the Header/Sidebar).
 */
export function SkipNavigation() {
  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLAnchorElement>) => {
      e.preventDefault();
      const main = document.getElementById('main-content');
      if (main) {
        main.focus({ preventScroll: false });
        main.scrollIntoView({ behavior: 'smooth' });
      }
    },
    [],
  );

  return (
    <a
      href="#main-content"
      onClick={handleClick}
      className={[
        // Visually hidden by default — pulled off-screen
        'fixed left-0 top-0 z-[200] -translate-y-full',
        // Visible when focused
        'focus:translate-y-0',
        // High-contrast styling
        'bg-primary text-primary-foreground',
        'px-6 py-3 text-base font-semibold',
        'rounded-br-lg shadow-lg',
        // Outline for focus visibility
        'focus:outline-none focus:ring-4 focus:ring-ring focus:ring-offset-2',
        // Smooth transition
        'transition-transform duration-200 ease-out',
        // Dark-mode support (primary already adapts via CSS vars, but add
        // explicit dark overrides for ring-offset)
        'dark:ring-offset-background',
      ].join(' ')}
      data-testid="skip-navigation"
    >
      Skip to main content
    </a>
  );
}
