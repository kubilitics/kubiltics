import { useCallback, useEffect, useRef, useState } from 'react';
import {
  CHAT_PANEL_DEFAULT_WIDTH,
  CHAT_PANEL_MAX_WIDTH,
  CHAT_PANEL_MIN_WIDTH,
  clampPanelWidth,
  useChatPanelLayoutStore,
} from '@/stores/chatPanelLayoutStore';
import { cn } from '@/lib/utils';

// ChatResizeHandle is the 2px-wide affordance pinned to the panel's
// left edge. Invisible at rest (the panel border carries the visual
// weight), it brightens to a 6px brand-blue rule on hover/focus/drag.
// Designed to feel like Linear/Cursor's resize gutter — a tool that's
// available but never intrusive.
export function ChatResizeHandle() {
  const setWidth = useChatPanelLayoutStore((s) => s.setWidth);
  const resetWidth = useChatPanelLayoutStore((s) => s.resetWidth);
  const setResizing = useChatPanelLayoutStore((s) => s.setResizing);
  const width = useChatPanelLayoutStore((s) => s.width);
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const [hovered, setHovered] = useState(false);
  const [active, setActive] = useState(false);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      (e.currentTarget as HTMLDivElement).setPointerCapture?.(e.pointerId);
      dragRef.current = { startX: e.clientX, startWidth: width };
      setActive(true);
      setResizing(true);
      // Force the system cursor across the whole document so the user's
      // pointer doesn't flash to text/default while crossing other panes.
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    },
    [width, setResizing],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!dragRef.current) return;
      // Drag-left grows the panel (panel hugs the right edge).
      const dx = dragRef.current.startX - e.clientX;
      setWidth(clampPanelWidth(dragRef.current.startWidth + dx));
    },
    [setWidth],
  );

  const onPointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!dragRef.current) return;
      (e.currentTarget as HTMLDivElement).releasePointerCapture?.(e.pointerId);
      dragRef.current = null;
      setActive(false);
      setResizing(false);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    },
    [setResizing],
  );

  // Keyboard resize: ←/→ adjust by 16px, ⇧←/→ by 64px, Enter resets.
  // Makes the gutter screen-reader and keyboard-only friendly without
  // adding a visible button to the chrome.
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      const step = e.shiftKey ? 64 : 16;
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        setWidth(clampPanelWidth(width + step));
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        setWidth(clampPanelWidth(width - step));
      } else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        resetWidth();
      }
    },
    [setWidth, resetWidth, width],
  );

  // Defensive: if pointerup never fires (e.g. window loses focus mid-drag),
  // restore document state so the cursor doesn't get stuck on col-resize.
  useEffect(() => {
    if (!active) return;
    const onWindowBlur = () => {
      dragRef.current = null;
      setActive(false);
      setResizing(false);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    window.addEventListener('blur', onWindowBlur);
    return () => window.removeEventListener('blur', onWindowBlur);
  }, [active, setResizing]);

  const visible = hovered || active;

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize chat panel (←/→ to adjust, ⇧←/→ to jump, Enter to reset)"
      aria-valuemin={CHAT_PANEL_MIN_WIDTH}
      aria-valuemax={CHAT_PANEL_MAX_WIDTH}
      aria-valuenow={width}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onKeyDown={onKeyDown}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onDoubleClick={resetWidth}
      title={`Drag to resize · double-click to reset (${CHAT_PANEL_DEFAULT_WIDTH}px)`}
      className={cn(
        // Sit outside the panel's left edge so the gutter is grabbable
        // even when the user aims slightly past the visible border.
        'absolute top-0 left-[-3px] z-50 h-full w-[6px]',
        'cursor-col-resize select-none',
        'outline-none focus-visible:ring-2 focus-visible:ring-primary/50',
      )}
    >
      {/* Always-visible 1px rule sits flush with the panel border so the
          user knows the edge is interactive at rest. Brightens to a 3px
          brand-blue rule when hovered/dragged for grab feedback. */}
      <div
        className={cn(
          'absolute top-0 right-0 h-full bg-border transition-[width,background-color]',
          visible ? 'w-[3px] bg-primary' : 'w-[1px]',
        )}
        style={{
          transitionDuration: '120ms',
          transitionTimingFunction: 'cubic-bezier(0.16, 1, 0.3, 1)',
        }}
      />
      {/* A subtle vertical "grip" — three short marks centered vertically
          — that fades up to full strength on hover. Matches the Linear /
          Cursor convention so power users instantly recognise the
          gutter as draggable. */}
      <div
        className={cn(
          'pointer-events-none absolute top-1/2 right-[1px] -translate-y-1/2',
          'flex flex-col items-center gap-[2px]',
          'transition-opacity duration-150',
          visible ? 'opacity-90' : 'opacity-30',
        )}
        aria-hidden="true"
      >
        <span className="block h-[3px] w-[3px] rounded-full bg-foreground/60" />
        <span className="block h-[3px] w-[3px] rounded-full bg-foreground/60" />
        <span className="block h-[3px] w-[3px] rounded-full bg-foreground/60" />
      </div>
    </div>
  );
}
