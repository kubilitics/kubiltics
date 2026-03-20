import React from 'react';

interface SearchHighlightProps {
  text: string;
  query: string;
  /** Class applied to the highlighted <mark> element */
  highlightClassName?: string;
}

/**
 * Highlights occurrences of `query` within `text`.
 * Case-insensitive. Returns the original text if query is empty.
 */
export function SearchHighlight({
  text,
  query,
  highlightClassName = 'bg-yellow-100 dark:bg-yellow-900/40 text-inherit rounded-sm px-0.5',
}: SearchHighlightProps) {
  if (!query.trim()) return <>{text}</>;

  const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`(${escapedQuery})`, 'gi');
  const parts = text.split(regex);

  return (
    <>
      {parts.map((part, i) =>
        regex.test(part) ? (
          <mark key={i} className={highlightClassName}>
            {part}
          </mark>
        ) : (
          <React.Fragment key={i}>{part}</React.Fragment>
        )
      )}
    </>
  );
}
