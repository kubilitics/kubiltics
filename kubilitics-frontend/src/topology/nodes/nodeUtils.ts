/**
 * Shared utility functions for topology nodes.
 * Color functions delegate to designTokens for single-source-of-truth consistency.
 */
import {
  statusDotClass,
  categoryBorderClass,
  categoryHeaderClass,
} from "../constants/designTokens";

/** Returns an emoji icon for a resource category. */
export function categoryIcon(category: string): string {
  const icons: Record<string, string> = {
    compute: "\u2699\uFE0F",       // gear
    workload: "\u2699\uFE0F",      // gear (alias)
    networking: "\uD83C\uDF10",    // globe
    config: "\uD83D\uDCC4",       // page
    configuration: "\uD83D\uDCC4", // page (alias)
    storage: "\uD83D\uDCBE",      // floppy
    security: "\uD83D\uDD12",     // lock
    rbac: "\uD83D\uDD12",         // lock (alias)
    scheduling: "\uD83D\uDDA5\uFE0F", // desktop
    cluster: "\uD83D\uDDA5\uFE0F", // desktop (alias)
    scaling: "\uD83D\uDCC8",      // chart
    policy: "\uD83D\uDEE1\uFE0F",  // shield
    custom: "\uD83D\uDD37",       // diamond
  };
  return icons[category] || "\uD83D\uDD37";
}

/** Returns a Tailwind bg class for a status dot. Delegates to designTokens. */
export function statusColor(status: string): string {
  return statusDotClass(status);
}

/** Returns a Tailwind border class for category. Delegates to designTokens. */
export function categoryBorderColor(category: string): string {
  return categoryBorderClass(category);
}

/** Returns a Tailwind bg class for category header. Delegates to designTokens. */
export function categoryHeaderBg(category: string): string {
  return categoryHeaderClass(category);
}

/** Format bytes to human readable. */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "Ki", "Mi", "Gi", "Ti"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}

/** Format millicores to human readable. */
export function formatCPU(millis: number): string {
  if (millis >= 1000) return (millis / 1000).toFixed(1) + " cores";
  return millis + "m";
}
