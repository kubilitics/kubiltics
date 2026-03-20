import React, { useState, useEffect, useCallback, useRef } from 'react';
import type cytoscape from 'cytoscape';
import { Search, X, ChevronUp, ChevronDown } from 'lucide-react';
import type { HighlightManager } from './HighlightManager';

export interface TopologySearchProps {
  cy: cytoscape.Core;
  highlightManager: HighlightManager;
  /** Optional ref for parent to focus search (e.g. Cmd/Ctrl+F) */
  searchInputRef?: React.RefObject<HTMLInputElement | null>;
}

/**
 * TopologySearch - Real-time search with match counter and navigation
 *
 * PRD Section 7.6: Search & Filter
 *
 * Features:
 * - Real-time filtering on keyup (debounce 150ms per PRD 7.6)
 * - Search scope: name, kind, namespace, labels, annotations
 * - Match counter (X of Y)
 * - Navigation arrows to cycle through matches
 * - Yellow border highlight for matches
 * - Clear button
 * - Keyboard shortcuts: / (focus search), Escape (clear), Enter (next match)
 */
export const TopologySearch: React.FC<TopologySearchProps> = ({
  cy,
  highlightManager,
  searchInputRef: parentInputRef,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [matches, setMatches] = useState<string[]>([]);
  const [currentMatchIndex, setCurrentMatchIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Debounce 150ms per PRD Section 7.6 (Task 4.6)
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(searchQuery), 150);
    return () => clearTimeout(t);
  }, [searchQuery]);

  const setRef = useCallback(
    (el: HTMLInputElement | null) => {
      (inputRef as React.MutableRefObject<HTMLInputElement | null>).current = el;
      if (parentInputRef)
        (parentInputRef as React.MutableRefObject<HTMLInputElement | null>).current = el;
    },
    [parentInputRef]
  );

  /**
   * Search nodes based on query
   *
   * Search scope (PRD Section 7.6):
   * - Node name
   * - Node kind (Pod, Deployment, Service)
   * - Namespace
   * - Labels (key=value)
   * - Annotations
   */
  const searchNodes = useCallback(
    (query: string): string[] => {
      if (!query.trim()) return [];

      const matchingNodeIds: string[] = [];
      const lowerQuery = query.toLowerCase();

      cy.nodes().forEach((node) => {
        const data = node.data();
        const name = (data.name || '').toLowerCase();
        const kind = (data.kind || '').toLowerCase();
        const namespace = (data.namespace || '').toLowerCase();

        // Search in name, kind, namespace
        if (
          name.includes(lowerQuery) ||
          kind.includes(lowerQuery) ||
          namespace.includes(lowerQuery)
        ) {
          matchingNodeIds.push(node.id());
          return;
        }

        // Search in labels (format: "key=value")
        const labels = data.labels || {};
        for (const [key, value] of Object.entries(labels)) {
          const labelString = `${key}=${value}`.toLowerCase();
          if (
            labelString.includes(lowerQuery) ||
            key.toLowerCase().includes(lowerQuery) ||
            String(value).toLowerCase().includes(lowerQuery)
          ) {
            matchingNodeIds.push(node.id());
            return;
          }
        }

        // Search in annotations
        const annotations = data.annotations || {};
        for (const [key, value] of Object.entries(annotations)) {
          if (
            key.toLowerCase().includes(lowerQuery) ||
            String(value).toLowerCase().includes(lowerQuery)
          ) {
            matchingNodeIds.push(node.id());
            return;
          }
        }
      });

      return matchingNodeIds;
    },
    [cy]
  );

  /**
   * Handle search (runs on debounced query)
   */
  useEffect(() => {
    const matchingNodes = searchNodes(debouncedQuery);
    setMatches(matchingNodes);
    setCurrentMatchIndex(0);

    // Update HighlightManager with search results
    if (matchingNodes.length > 0) {
      highlightManager.setSearchResults(new Set(matchingNodes));
    } else {
      highlightManager.clearSearchResults();
    }
  }, [debouncedQuery, searchNodes, highlightManager]);

  /**
   * Navigate to next match
   */
  const goToNextMatch = useCallback(() => {
    if (matches.length === 0) return;

    const nextIndex = (currentMatchIndex + 1) % matches.length;
    setCurrentMatchIndex(nextIndex);

    // Center view on the match
    const nodeId = matches[nextIndex];
    const node = cy.getElementById(nodeId);
    if (node.length > 0) {
      cy.animate(
        {
          center: { eles: node },
          zoom: cy.zoom() < 1 ? 1 : cy.zoom(),
        },
        {
          duration: 300,
          easing: 'ease-in-out',
        }
      );
    }
  }, [matches, currentMatchIndex, cy]);

  /**
   * Navigate to previous match
   */
  const goToPreviousMatch = useCallback(() => {
    if (matches.length === 0) return;

    const prevIndex =
      currentMatchIndex === 0 ? matches.length - 1 : currentMatchIndex - 1;
    setCurrentMatchIndex(prevIndex);

    // Center view on the match
    const nodeId = matches[prevIndex];
    const node = cy.getElementById(nodeId);
    if (node.length > 0) {
      cy.animate(
        {
          center: { eles: node },
          zoom: cy.zoom() < 1 ? 1 : cy.zoom(),
        },
        {
          duration: 300,
          easing: 'ease-in-out',
        }
      );
    }
  }, [matches, currentMatchIndex, cy]);

  /**
   * Clear search
   */
  const clearSearch = useCallback(() => {
    setSearchQuery('');
    setDebouncedQuery('');
    setMatches([]);
    setCurrentMatchIndex(0);
    highlightManager.clearSearchResults();
  }, [highlightManager]);

  /**
   * Keyboard shortcuts
   * - / : Focus search
   * - Escape : Clear search
   * - Enter : Next match
   */
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // / to focus search (only if not already focused on an input)
      if (
        e.key === '/' &&
        document.activeElement?.tagName !== 'INPUT' &&
        document.activeElement?.tagName !== 'TEXTAREA'
      ) {
        e.preventDefault();
        inputRef.current?.focus();
      }

      // Escape to clear search (only if search input is focused)
      if (e.key === 'Escape' && document.activeElement === inputRef.current) {
        clearSearch();
        inputRef.current?.blur();
      }

      // Enter to go to next match (only if search input is focused)
      if (e.key === 'Enter' && document.activeElement === inputRef.current) {
        e.preventDefault();
        goToNextMatch();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [clearSearch, goToNextMatch]);

  return (
    <div className="flex items-center gap-2 bg-white border-2 border-slate-300 rounded-lg px-3 py-2 shadow-sm">
      {/* Search Icon */}
      <Search className="w-4 h-4 text-slate-400 flex-shrink-0" />

      {/* Search Input */}
      <input
        ref={setRef}
        type="text"
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
        placeholder="Search resources... (press / to focus)"
        className="flex-1 outline-none text-sm text-slate-900 placeholder-slate-400 min-w-0"
      />

      {/* Match Counter */}
      {searchQuery && (
        <div className="flex items-center gap-2 flex-shrink-0">
          {matches.length > 0 ? (
            <>
              {/* Counter Text */}
              <span className="text-xs font-semibold text-slate-600 whitespace-nowrap">
                {currentMatchIndex + 1} of {matches.length}
              </span>

              {/* Navigation Arrows */}
              <div className="flex items-center gap-0.5">
                <button
                  onClick={goToPreviousMatch}
                  className="p-1 rounded hover:bg-slate-100 transition-colors"
                  title="Previous match (Shift+Enter)"
                  disabled={matches.length === 0}
                >
                  <ChevronUp className="w-4 h-4 text-slate-600" />
                </button>
                <button
                  onClick={goToNextMatch}
                  className="p-1 rounded hover:bg-slate-100 transition-colors"
                  title="Next match (Enter)"
                  disabled={matches.length === 0}
                >
                  <ChevronDown className="w-4 h-4 text-slate-600" />
                </button>
              </div>
            </>
          ) : (
            <span className="text-xs font-semibold text-slate-400 whitespace-nowrap">
              No results
            </span>
          )}

          {/* Clear Button */}
          <button
            onClick={clearSearch}
            className="p-1 rounded hover:bg-slate-100 transition-colors"
            title="Clear search (Escape)"
          >
            <X className="w-4 h-4 text-slate-600" />
          </button>
        </div>
      )}
    </div>
  );
};
