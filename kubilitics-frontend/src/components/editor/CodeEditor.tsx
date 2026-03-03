import { useRef, useCallback, useState, useEffect } from 'react';
import Editor, { type OnMount, type OnChange } from '@monaco-editor/react';
import type * as monacoType from 'monaco-editor';
import { cn } from '@/lib/utils';

// ── Fallback textarea ────────────────────────────────────────────────────────
// Rendered if Monaco fails to initialize (e.g. CSP blocks workers, stale cache).
// Provides full editing capability — users are never blocked.

function TextareaFallback({
  value,
  onChange,
  readOnly,
  minHeight,
  fontSize,
}: {
  value: string;
  onChange?: (v: string) => void;
  readOnly: boolean;
  minHeight: string;
  fontSize: 'small' | 'medium' | 'large';
}) {
  const sizeMap = { small: '13px', medium: '15px', large: '17px' };
  return (
    <div className="flex flex-col h-full">
      <textarea
        value={value}
        onChange={readOnly ? undefined : (e) => onChange?.(e.target.value)}
        readOnly={readOnly}
        spellCheck={false}
        className={cn(
          'flex-1 w-full resize-none font-mono p-4',
          'bg-[#FAFCFF] text-[#1b1f23] border-0 outline-none',
          'leading-relaxed',
          readOnly && 'cursor-default opacity-80',
        )}
        style={{ minHeight, fontSize: sizeMap[fontSize] }}
      />
    </div>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

interface CodeEditorProps {
  value: string;
  onChange?: (value: string) => void;
  readOnly?: boolean;
  className?: string;
  minHeight?: string;
  placeholder?: string;
  fontSize?: 'small' | 'medium' | 'large';
  /** @deprecated Ignored — extensions are CodeMirror-specific. */
  extensions?: unknown[];
}

const fontSizeMap = { small: 13, medium: 15, large: 17 };

// How long to wait for Monaco to mount before showing the textarea fallback.
const MONACO_LOAD_TIMEOUT_MS = 8000;

export function CodeEditor({
  value,
  onChange,
  readOnly = false,
  className,
  minHeight = '400px',
  fontSize = 'small',
}: CodeEditorProps) {
  const editorRef = useRef<monacoType.editor.IStandaloneCodeEditor | null>(null);
  const [monacoReady, setMonacoReady] = useState(false);
  const [monacoFailed, setMonacoFailed] = useState(false);

  // Timeout: if Monaco hasn't mounted after MONACO_LOAD_TIMEOUT_MS, fall back
  // to textarea so the user is never stuck on "Loading editor…"
  useEffect(() => {
    if (monacoReady) return;
    const timer = setTimeout(() => {
      if (!monacoReady) {
        console.warn('[CodeEditor] Monaco failed to load within timeout — using textarea fallback');
        setMonacoFailed(true);
      }
    }, MONACO_LOAD_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [monacoReady]);

  const handleMount: OnMount = useCallback((editor, monaco) => {
    editorRef.current = editor;
    setMonacoReady(true);

    // ── Define Kubilitics light theme (VS Code Light+ inspired) ──
    monaco.editor.defineTheme('kubilitics-light', {
      base: 'vs',
      inherit: true,
      rules: [
        // YAML keys
        { token: 'type.yaml', foreground: '0550ae', fontStyle: 'bold' },
        { token: 'tag.yaml', foreground: '8250df' },
        // Strings
        { token: 'string.yaml', foreground: '116329' },
        { token: 'string', foreground: '116329' },
        // Numbers & booleans
        { token: 'number.yaml', foreground: '953800', fontStyle: 'bold' },
        { token: 'number', foreground: '953800' },
        { token: 'keyword.yaml', foreground: '953800', fontStyle: 'bold' },
        { token: 'keyword', foreground: '0550ae', fontStyle: 'bold' },
        // Comments
        { token: 'comment.yaml', foreground: '6e7781', fontStyle: 'italic' },
        { token: 'comment', foreground: '6e7781', fontStyle: 'italic' },
        // Operators & punctuation
        { token: 'operators.yaml', foreground: '6e7781' },
        { token: 'delimiter', foreground: '6e7781' },
      ],
      colors: {
        'editor.background': '#FAFCFF',
        'editor.foreground': '#1b1f23',
        'editor.lineHighlightBackground': '#f0f4f8',
        'editor.selectionBackground': '#3b82f640',
        'editor.inactiveSelectionBackground': '#3b82f620',
        'editorLineNumber.foreground': '#94a3b8',
        'editorLineNumber.activeForeground': '#334155',
        'editorGutter.background': '#f8fafc',
        'editorCursor.foreground': '#3b82f6',
        'editor.findMatchBackground': '#fbbf2460',
        'editor.findMatchHighlightBackground': '#fbbf2430',
        'editorBracketMatch.background': '#3b82f630',
        'editorBracketMatch.border': '#3b82f680',
        'editorIndentGuide.background': '#e2e8f0',
        'editorIndentGuide.activeBackground': '#94a3b8',
        'minimap.background': '#f8fafc',
        'scrollbarSlider.background': '#cbd5e140',
        'scrollbarSlider.hoverBackground': '#94a3b860',
        'scrollbarSlider.activeBackground': '#64748b80',
        'editorOverviewRuler.border': '#e2e8f000',
        'editorWidget.background': '#ffffff',
        'editorWidget.border': '#e2e8f0',
        'input.background': '#f8fafc',
        'input.border': '#e2e8f0',
        'focusBorder': '#3b82f6',
      },
    });

    monaco.editor.setTheme('kubilitics-light');

    // Focus the editor
    editor.focus();
  }, []);

  const handleChange: OnChange = useCallback((val) => {
    if (onChange && val !== undefined) {
      onChange(val);
    }
  }, [onChange]);

  // Monaco failed to load — use resilient textarea fallback
  if (monacoFailed) {
    return (
      <div
        className={cn(
          'rounded-xl border border-border overflow-hidden',
          'shadow-sm',
          'bg-[#FAFCFF]',
          className,
        )}
        style={{ minHeight }}
      >
        <TextareaFallback
          value={value}
          onChange={onChange}
          readOnly={readOnly}
          minHeight={minHeight}
          fontSize={fontSize}
        />
      </div>
    );
  }

  return (
    <div
      className={cn(
        'rounded-xl border border-border overflow-hidden',
        'shadow-sm',
        'bg-[#FAFCFF]',
        className,
      )}
      style={{ minHeight }}
    >
      <Editor
        height={minHeight}
        defaultLanguage="yaml"
        value={value}
        onChange={readOnly ? undefined : handleChange}
        onMount={handleMount}
        theme="kubilitics-light"
        loading={
          <div className="flex items-center justify-center h-full gap-3 text-muted-foreground">
            <div className="h-5 w-5 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
            <span className="text-sm font-medium">Loading editor…</span>
          </div>
        }
        options={{
          readOnly,
          fontSize: fontSizeMap[fontSize],
          fontFamily: '"JetBrains Mono", "SF Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
          fontLigatures: true,
          lineHeight: 22,
          letterSpacing: 0.3,
          // VS Code experience
          minimap: {
            enabled: true,
            scale: 2,
            showSlider: 'mouseover',
            renderCharacters: false,
          },
          // Scrollbar styling
          scrollbar: {
            vertical: 'auto',
            horizontal: 'auto',
            verticalScrollbarSize: 10,
            horizontalScrollbarSize: 10,
            useShadows: false,
          },
          // Editor behavior
          automaticLayout: true,
          wordWrap: 'on',
          wrappingStrategy: 'advanced',
          tabSize: 2,
          insertSpaces: true,
          renderWhitespace: 'selection',
          // Bracket & guides
          bracketPairColorization: { enabled: true },
          guides: {
            bracketPairs: true,
            indentation: true,
            highlightActiveIndentation: true,
          },
          // Line decorations
          renderLineHighlight: 'all',
          renderLineHighlightOnlyWhenFocus: false,
          lineNumbers: 'on',
          glyphMargin: false,
          folding: true,
          foldingStrategy: 'indentation',
          showFoldingControls: 'mouseover',
          // Find / search
          find: {
            addExtraSpaceOnTop: true,
            autoFindInSelection: 'multiline',
            seedSearchStringFromSelection: 'selection',
          },
          // Smooth scrolling
          smoothScrolling: true,
          cursorBlinking: 'smooth',
          cursorSmoothCaretAnimation: 'on',
          cursorStyle: 'line',
          cursorWidth: 2,
          // Padding
          padding: { top: 16, bottom: 16 },
          // Line number column width
          lineNumbersMinChars: 4,
          lineDecorationsWidth: 8,
          // Misc
          contextmenu: true,
          quickSuggestions: false,
          suggest: { showWords: false },
          parameterHints: { enabled: false },
          overviewRulerBorder: false,
          hideCursorInOverviewRuler: true,
          scrollBeyondLastLine: false,
          colorDecorators: true,
          // Accessibility
          accessibilitySupport: 'auto',
          // Selection
          multiCursorModifier: 'alt',
          selectionHighlight: true,
          occurrencesHighlight: 'singleFile',
          // Hover
          hover: { enabled: false },
          // Sticky scroll (VS Code-like breadcrumbs for nested YAML)
          stickyScroll: { enabled: true, maxLineCount: 3 },
        }}
      />
    </div>
  );
}
