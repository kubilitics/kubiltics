import { useState, useRef, useEffect } from "react";
import { useCatalog, useInstalledAddons } from "@/hooks/useAddOnCatalog";
import { AddOnCard } from "./AddOnCard";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Search, RefreshCw, Layers, AlertCircle, X } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useActiveClusterId } from "@/hooks/useActiveClusterId";
import { cn } from "@/lib/utils";

const ITEMS_PER_PAGE = 12;

// ─── Pagination helper ────────────────────────────────────────────────────────
function buildPageList(current: number, total: number): (number | "…")[] {
    if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
    const pages: (number | "…")[] = [1];
    if (current > 3) pages.push("…");
    for (let p = Math.max(2, current - 1); p <= Math.min(total - 1, current + 1); p++) pages.push(p);
    if (current < total - 2) pages.push("…");
    pages.push(total);
    return pages;
}

// ─── Loading skeleton row ─────────────────────────────────────────────────────
function CatalogSkeleton() {
    return (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-5">
            {Array.from({ length: 9 }).map((_, i) => (
                <div key={i} className="flex flex-col rounded-2xl border border-border/40 bg-card p-5 gap-4 animate-pulse">
                    {/* Header: logo + title */}
                    <div className="flex gap-4 items-start">
                        <Skeleton className="h-[72px] w-[72px] rounded-2xl shrink-0" />
                        <div className="flex-1 pt-1 space-y-2">
                            <Skeleton className="h-4 w-3/4" />
                            <Skeleton className="h-3 w-1/2" />
                            <Skeleton className="h-5 w-20 rounded-full" />
                        </div>
                    </div>
                    {/* Description */}
                    <div className="space-y-1.5">
                        <Skeleton className="h-3 w-full" />
                        <Skeleton className="h-3 w-5/6" />
                        <Skeleton className="h-3 w-4/6" />
                    </div>
                    {/* Tags */}
                    <div className="flex gap-2">
                        <Skeleton className="h-4 w-14 rounded-md" />
                        <Skeleton className="h-4 w-18 rounded-md" />
                    </div>
                    <div className="h-px bg-border/40" />
                    {/* Footer */}
                    <div className="flex justify-between">
                        <Skeleton className="h-8 w-20 rounded-lg" />
                        <Skeleton className="h-4 w-24 rounded-md" />
                    </div>
                </div>
            ))}
        </div>
    );
}

// ─── CatalogBrowser ───────────────────────────────────────────────────────────
export function CatalogBrowser() {
    const [searchInput, setSearchInput] = useState("");
    const [searchApi, setSearchApi] = useState("");
    const [currentPage, setCurrentPage] = useState(1);
    const searchRef = useRef<HTMLInputElement>(null);

    // Debounce search and reset to page 1 when it changes
    useEffect(() => {
        const t = setTimeout(() => {
            setSearchApi(searchInput.trim());
            setCurrentPage(1);
        }, 400);
        return () => clearTimeout(t);
    }, [searchInput]);

    const clusterId = useActiveClusterId();
    const { data, isLoading, error, refetch } = useCatalog(currentPage, ITEMS_PER_PAGE, searchApi || undefined);
    const { data: installed } = useInstalledAddons(clusterId || "");

    const items = data?.items ?? [];
    const total = data?.total ?? 0;
    const totalPages = Math.max(1, Math.ceil(total / ITEMS_PER_PAGE));

    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if (e.key === "/" && document.activeElement?.tagName !== "INPUT") {
                e.preventDefault();
                searchRef.current?.focus();
            }
        };
        window.addEventListener("keydown", handler);
        return () => window.removeEventListener("keydown", handler);
    }, []);

    const isInstalled = (addonId: string) => installed?.find(i => i.addon_id === addonId);
    const hasSearch = searchInput.trim().length > 0;

    // ── Error state ──────────────────────────────────────────────────────────
    if (error) {
        return (
            <div className="flex flex-col items-center justify-center py-24 rounded-2xl border border-destructive/20 bg-destructive/5">
                <div className="h-16 w-16 rounded-full bg-destructive/10 flex items-center justify-center mb-6 ring-8 ring-destructive/5">
                    <AlertCircle className="h-8 w-8 text-destructive" />
                </div>
                <h3 className="text-lg font-bold text-foreground">Failed to load catalog</h3>
                <p className="mt-2 text-sm text-muted-foreground max-w-sm text-center">
                    {error instanceof Error ? error.message : "There was an error fetching the add-ons catalog."}
                </p>
                <Button variant="outline" className="mt-8" onClick={() => refetch()}>
                    Try Again
                </Button>
            </div>
        );
    }

    return (
        <div className="flex flex-col gap-6 animate-fade-in">

            {/* ── Toolbar ────────────────────────────────────────────────────── */}
            <div className="flex flex-col lg:flex-row gap-4 items-stretch lg:items-center">

                {/* Search */}
                <div className="relative flex-1 group">
                    <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground group-focus-within:text-primary transition-colors pointer-events-none" />
                    <Input
                        ref={searchRef}
                        placeholder="Search by name, description or maintainer…"
                        className="pl-10 pr-14 h-11 rounded-xl bg-background text-sm"
                        value={searchInput}
                        onChange={(e) => setSearchInput(e.target.value)}
                    />
                    {searchInput ? (
                        <button
                            className="absolute right-3.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                            onClick={() => setSearchInput("")}
                        >
                            <X className="h-4 w-4" />
                        </button>
                    ) : (
                        <kbd className="absolute right-3.5 top-1/2 -translate-y-1/2 hidden sm:flex items-center px-1.5 py-0.5 bg-muted border border-border rounded text-[10px] font-medium text-muted-foreground pointer-events-none select-none">
                            /
                        </kbd>
                    )}
                </div>

                <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => refetch()}
                    className="h-10 w-10 rounded-xl shrink-0"
                    title="Refresh catalog"
                >
                    <RefreshCw className={cn("h-4 w-4 text-muted-foreground", isLoading && "animate-spin")} />
                </Button>
            </div>

            {!isLoading && (
                <p className="text-[13px] text-muted-foreground font-medium">
                    <span className="font-bold text-foreground">{total.toLocaleString()}</span>
                    {" "}package{total !== 1 ? "s" : ""} from Artifact Hub
                    {hasSearch && " (filtered)"}
                </p>
            )}

            {/* ── Grid / empty / loading ─────────────────────────────────────── */}
            {isLoading ? (
                <CatalogSkeleton />
            ) : items.length > 0 ? (
                <>
                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6 p-1 animate-in fade-in slide-in-from-bottom-2 duration-300">
                        {items.map(entry => {
                            const inst = isInstalled(entry.id);
                            return (
                                <AddOnCard
                                    key={entry.id}
                                    entry={entry}
                                    isInstalled={!!inst}
                                    installedVersion={inst?.installed_version}
                                />
                            );
                        })}
                    </div>

                    {/* ── Pagination ── */}
                    {totalPages > 1 && (
                        <div className="flex justify-center items-center gap-1.5 pt-4">
                            <button
                                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                                disabled={currentPage === 1}
                                className="h-9 px-4 rounded-xl text-[12px] font-semibold text-muted-foreground border border-border/60 bg-card hover:bg-muted transition-colors disabled:opacity-40 disabled:pointer-events-none"
                            >
                                Previous
                            </button>

                            {buildPageList(currentPage, totalPages).map((p, idx) =>
                                p === "…" ? (
                                    <span key={`ellipsis-${idx}`} className="h-9 w-9 flex items-center justify-center text-muted-foreground text-[12px] select-none">
                                        …
                                    </span>
                                ) : (
                                    <button
                                        key={p}
                                        onClick={() => setCurrentPage(p as number)}
                                        className={cn(
                                            "h-9 w-9 rounded-xl text-[12px] font-bold transition-all duration-150",
                                            currentPage === p
                                                ? "bg-primary text-primary-foreground shadow-sm"
                                                : "text-muted-foreground border border-border/60 bg-card hover:bg-muted"
                                        )}
                                    >
                                        {p}
                                    </button>
                                )
                            )}

                            <button
                                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                                disabled={currentPage === totalPages}
                                className="h-9 px-4 rounded-xl text-[12px] font-semibold text-muted-foreground border border-border/60 bg-card hover:bg-muted transition-colors disabled:opacity-40 disabled:pointer-events-none"
                            >
                                Next
                            </button>

                            <span className="ml-2 text-[11px] text-muted-foreground">
                                Page {currentPage} of {totalPages}
                            </span>
                        </div>
                    )}
                </>
            ) : (
                /* ── Empty state ── */
                <div className="flex flex-col items-center justify-center py-24 rounded-2xl border border-dashed border-border/60 bg-muted/20">
                    <div className="h-16 w-16 rounded-full bg-muted flex items-center justify-center mb-6 ring-8 ring-muted/30">
                        <Layers className="h-8 w-8 text-muted-foreground/40" />
                    </div>
                    <h3 className="text-lg font-bold text-foreground">No packages found</h3>
                    <p className="mt-2 text-sm text-muted-foreground max-w-sm text-center">
                        {hasSearch ? "Try a different search term." : "No results from Artifact Hub."}
                    </p>
                    {hasSearch && (
                        <Button variant="outline" className="mt-8" onClick={() => setSearchInput("")}>
                            Clear search
                        </Button>
                    )}
                </div>
            )}
        </div>
    );
}
