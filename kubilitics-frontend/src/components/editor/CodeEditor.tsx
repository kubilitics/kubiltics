import { useEffect, useRef, useCallback } from 'react';
import { EditorState, Extension, RangeSetBuilder } from '@codemirror/state';
import {
  EditorView, ViewPlugin, ViewUpdate, Decoration, DecorationSet,
  keymap, lineNumbers, highlightActiveLineGutter, highlightSpecialChars,
  drawSelection, dropCursor, rectangularSelection, crosshairCursor, highlightActiveLine,
} from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { yaml } from '@codemirror/lang-yaml';
import { syntaxHighlighting, indentOnInput, bracketMatching, foldGutter, foldKeymap, HighlightStyle } from '@codemirror/language';
import { tags } from '@lezer/highlight';
import { cn } from '@/lib/utils';

// ── Kubilitics editor theme ─────────────────────────────────────────────────────

const createKubiliticsTheme = (fontSize: string) => EditorView.theme({
  '&': {
    height: '100%',
    fontSize: fontSize,
    backgroundColor: 'hsl(var(--background))',
    color: 'hsl(var(--foreground))',
  },
  '.cm-content': {
    caretColor: 'hsl(var(--primary))',
    fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
    padding: '12px 0',
  },
  '.cm-cursor, .cm-dropCursor': {
    borderLeftColor: 'hsl(var(--primary))',
    borderLeftWidth: '2px',
  },
  '.cm-selectionBackground, .cm-content ::selection': {
    backgroundColor: 'hsl(var(--primary) / 0.2)',
  },
  '.cm-activeLine': { backgroundColor: 'hsl(var(--muted) / 0.3)' },
  '.cm-activeLineGutter': { backgroundColor: 'hsl(var(--muted) / 0.3)' },
  '.cm-gutters': {
    backgroundColor: 'hsl(var(--muted) / 0.3)',
    color: 'hsl(var(--muted-foreground))',
    border: 'none',
    borderRight: '1px solid hsl(var(--border))',
    paddingRight: '8px',
  },
  '.cm-lineNumbers .cm-gutterElement': {
    padding: '0 8px 0 16px',
    minWidth: '40px',
    fontSize: '12px',
  },
  '.cm-foldGutter .cm-gutterElement': { padding: '0 4px', cursor: 'pointer' },
  '.cm-foldPlaceholder': {
    backgroundColor: 'hsl(var(--muted))',
    color: 'hsl(var(--muted-foreground))',
    border: 'none',
    padding: '0 4px',
    borderRadius: '4px',
  },
  '.cm-scroller': { overflow: 'auto', fontFamily: 'inherit' },
  '.cm-matchingBracket': {
    backgroundColor: 'hsl(var(--primary) / 0.3)',
    outline: '1px solid hsl(var(--primary) / 0.5)',
  },
  // URL link decoration
  '.cm-yaml-url': {
    color: '#2563eb',
    textDecoration: 'underline',
    textDecorationColor: '#93c5fd',
    cursor: 'pointer',
  },
  // YAML document separator ---
  '.cm-yaml-doc-sep': {
    color: '#7c3aed',
    fontWeight: 'bold',
  },
});

// ── Syntax highlight colours (One Light-inspired, readable on light & dark) ────
//
//  · YAML keys  (propertyName)  → bold dark-blue
//  · String values              → green
//  · Numbers / booleans         → amber/orange
//  · Comments                   → gray italic
//  · Anchors / aliases          → purple
//  · Document separators ---    → purple (meta tag)

const kubiliticsHighlightStyle = HighlightStyle.define([
  // YAML mapping keys — the most important differentiation
  { tag: tags.propertyName,                color: '#0550ae', fontWeight: '600' },
  { tag: tags.attributeName,               color: '#0550ae', fontWeight: '600' },
  // String values
  { tag: tags.string,                      color: '#116329' },
  { tag: tags.special(tags.string),        color: '#116329' },
  { tag: tags.attributeValue,              color: '#116329' },
  // Numbers, booleans, null
  { tag: tags.number,                      color: '#953800', fontWeight: '600' },
  { tag: tags.bool,                        color: '#953800', fontWeight: '600' },
  { tag: tags.null,                        color: '#953800' },
  { tag: tags.atom,                        color: '#953800' },
  // Keywords (true / false / null as keywords in some YAML parsers)
  { tag: tags.keyword,                     color: '#953800', fontWeight: '600' },
  // Comments — muted gray italic
  { tag: tags.comment,                     color: '#6e7781', fontStyle: 'italic' },
  // YAML anchors (&anchor) and aliases (*alias)
  { tag: tags.variableName,               color: '#6639ba' },
  { tag: tags.definition(tags.variableName), color: '#6639ba', fontWeight: '600' },
  // Document separator --- and other meta tokens
  { tag: tags.meta,                        color: '#8250df', fontWeight: 'bold' },
  { tag: tags.tagName,                     color: '#8250df' },
  // Operators and punctuation (: - [ ] { })
  { tag: tags.operator,                    color: '#6e7781' },
  { tag: tags.punctuation,                 color: '#6e7781' },
]);

// ── URL highlight decoration ──────────────────────────────────────────────────
// Scans visible ranges for http/https URLs and marks them with .cm-yaml-url

const URL_RE = /https?:\/\/[^\s,'")\]>}\n]+/g;
const urlMark = Decoration.mark({ class: 'cm-yaml-url' });

function buildUrlDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  for (const { from, to } of view.visibleRanges) {
    const text = view.state.doc.sliceString(from, to);
    URL_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = URL_RE.exec(text)) !== null) {
      builder.add(from + m.index, from + m.index + m[0].length, urlMark);
    }
  }
  return builder.finish();
}

const urlHighlighter = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) { this.decorations = buildUrlDecorations(view); }
    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged) {
        this.decorations = buildUrlDecorations(update.view);
      }
    }
  },
  { decorations: v => v.decorations },
);

// ── Component ─────────────────────────────────────────────────────────────────

interface CodeEditorProps {
  value: string;
  onChange?: (value: string) => void;
  readOnly?: boolean;
  className?: string;
  minHeight?: string;
  placeholder?: string;
  extensions?: Extension[];
  fontSize?: 'small' | 'medium' | 'large';
}

const EMPTY_EXTENSIONS: Extension[] = [];
const fontSizeMap = { small: '13px', medium: '15px', large: '17px' };

export function CodeEditor({
  value,
  onChange,
  readOnly = false,
  className,
  minHeight = '400px',
  extensions: additionalExtensions = EMPTY_EXTENSIONS,
  fontSize = 'small',
}: CodeEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);

  useEffect(() => { onChangeRef.current = onChange; }, [onChange]);

  const createExtensions = useCallback(() => {
    const base: Extension[] = [
      lineNumbers(),
      highlightActiveLineGutter(),
      highlightSpecialChars(),
      history(),
      foldGutter({ openText: '▼', closedText: '▶' }),
      drawSelection(),
      dropCursor(),
      EditorState.allowMultipleSelections.of(true),
      indentOnInput(),
      bracketMatching(),
      rectangularSelection(),
      crosshairCursor(),
      highlightActiveLine(),
      keymap.of([...defaultKeymap, ...historyKeymap, ...foldKeymap, indentWithTab]),
      yaml(),
      createKubiliticsTheme(fontSizeMap[fontSize]),
      syntaxHighlighting(kubiliticsHighlightStyle),
      urlHighlighter,
      EditorView.lineWrapping,
      ...additionalExtensions,
    ];

    if (readOnly) {
      base.push(EditorState.readOnly.of(true));
    } else {
      base.push(
        EditorView.updateListener.of((update) => {
          if (update.docChanged && onChangeRef.current) {
            onChangeRef.current(update.state.doc.toString());
          }
        }),
      );
    }

    return base;
  }, [readOnly, additionalExtensions, fontSize]);

  // Create the editor once (or when extensions change)
  useEffect(() => {
    if (!editorRef.current) return;

    const state = EditorState.create({
      doc: value,
      extensions: createExtensions(),
    });

    const view = new EditorView({ state, parent: editorRef.current });
    viewRef.current = view;

    return () => { view.destroy(); viewRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [createExtensions]);

  // Sync value prop → editor whenever it diverges from the current doc.
  //
  // This covers two cases:
  //  1. Read-only mode: external updates (e.g. refetch) must always reflect in the editor.
  //  2. Editable mode: external seeds (e.g. default values arriving after mount) must also
  //     be applied. User-typed content is safe because onChange fires → store updates →
  //     the new prop value matches what the editor already has, so the equality guard
  //     below prevents any spurious dispatch.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (value === current) return; // nothing to do — guards user-typed content
    view.dispatch({
      changes: { from: 0, to: current.length, insert: value },
    });
  }, [value]);

  return (
    <div
      ref={editorRef}
      className={cn('rounded-lg border border-border overflow-hidden', className)}
      style={{ minHeight }}
    />
  );
}
