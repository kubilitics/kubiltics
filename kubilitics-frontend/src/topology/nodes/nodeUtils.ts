/**
 * Shared utility functions for topology nodes.
 */

/** Returns an emoji icon for a resource category. */
export function categoryIcon(category: string): string {
  const icons: Record<string, string> = {
    workload: "\u2699\uFE0F",      // gear
    networking: "\uD83C\uDF10",    // globe
    configuration: "\uD83D\uDCC4", // page
    storage: "\uD83D\uDCBE",      // floppy
    rbac: "\uD83D\uDD12",         // lock
    cluster: "\uD83D\uDDA5\uFE0F", // desktop
    scaling: "\uD83D\uDCC8",      // chart
    policy: "\uD83D\uDEE1\uFE0F",  // shield
  };
  return icons[category] || "\u2B1B";
}

/** Returns a Tailwind color class for a status indicator. */
export function statusColor(status: string): string {
  switch (status) {
    case "healthy":
    case "Running":
    case "Ready":
    case "Bound":
    case "Available":
      return "bg-emerald-500";
    case "warning":
    case "Pending":
    case "PartiallyAvailable":
      return "bg-amber-500";
    case "error":
    case "Failed":
    case "NotReady":
    case "Lost":
      return "bg-red-500";
    default:
      return "bg-gray-400";
  }
}

/** Returns a Tailwind border color class for category. */
export function categoryBorderColor(category: string): string {
  const colors: Record<string, string> = {
    workload: "border-blue-400",
    networking: "border-purple-400",
    configuration: "border-amber-400",
    storage: "border-cyan-400",
    rbac: "border-rose-400",
    cluster: "border-gray-400",
    scaling: "border-green-400",
    policy: "border-orange-400",
  };
  return colors[category] || "border-gray-300";
}

/** Returns a Tailwind background accent for category header. */
export function categoryHeaderBg(category: string): string {
  const colors: Record<string, string> = {
    workload: "bg-blue-500",
    networking: "bg-purple-500",
    configuration: "bg-amber-500",
    storage: "bg-cyan-500",
    rbac: "bg-rose-500",
    cluster: "bg-gray-600",
    scaling: "bg-green-500",
    policy: "bg-orange-500",
  };
  return colors[category] || "bg-gray-500";
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
