import React, { useEffect, useCallback } from "react";
import { Search, Bell, Settings, Command } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

export const CommandBar = () => {
    const openGlobalSearch = useCallback(() => {
        window.dispatchEvent(new CustomEvent('openGlobalSearch'));
    }, []);

    useEffect(() => {
        const down = (e: KeyboardEvent) => {
            if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                openGlobalSearch();
            }
        };
        document.addEventListener("keydown", down);
        return () => document.removeEventListener("keydown", down);
    }, [openGlobalSearch]);

    return (
        <div className="h-16 w-full flex items-center justify-between px-6 bg-background/80 backdrop-blur-md border-b border-border/40 sticky top-0 z-50 transition-all duration-300">
            {/* Search Trigger */}
            <button
                className="group relative flex items-center gap-3 px-4 py-2.5 bg-secondary/50 hover:bg-secondary/80 border border-border/50 rounded-xl transition-all duration-200 w-96 text-left shadow-sm hover:shadow-md"
                onClick={openGlobalSearch}
            >
                <Search className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-colors" />
                <span className="text-sm text-muted-foreground group-hover:text-foreground transition-colors">
                    Ask Kubilitics...
                </span>
                <div className="ml-auto flex items-center gap-1">
                    <kbd className="pointer-events-none inline-flex h-5 select-none items-center gap-1 rounded border border-border bg-background px-1.5 font-mono text-[10px] font-medium text-muted-foreground opacity-100 shadow-sm">
                        <span className="text-xs">⌘</span>K
                    </kbd>
                </div>

                {/* Glow effect on hover */}
                <div className="absolute inset-0 rounded-xl ring-2 ring-primary/20 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />
            </button>


        </div>
    );
};
