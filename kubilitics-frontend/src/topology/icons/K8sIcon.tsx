import { memo } from "react";
import k8sIconMap from "./k8sIconMap";

interface K8sIconProps {
  /** Kubernetes resource kind (e.g. "Pod", "Deployment", "Service") */
  kind: string;
  /** Icon size in pixels (default: 20) */
  size?: number;
  /** Additional CSS class names */
  className?: string;
  /** Show white circle backdrop behind icon (use on colored headers) */
  backdrop?: boolean;
}

/**
 * Renders an official Kubernetes community SVG icon for the given resource kind.
 * Falls back to a generic diamond icon if no matching SVG exists.
 *
 * Use backdrop=true when placing on colored backgrounds (e.g. node headers)
 * since the K8s SVGs have blue fill that blends into blue/purple headers.
 */
function K8sIconInner({ kind, size = 20, className, backdrop }: K8sIconProps) {
  const url = k8sIconMap[kind.toLowerCase()];

  if (!url) {
    return (
      <span
        className={className}
        style={{ fontSize: size, lineHeight: 1 }}
        aria-hidden="true"
      >
        🔷
      </span>
    );
  }

  const img = (
    <img
      src={url}
      alt=""
      aria-hidden="true"
      width={size}
      height={size}
      className={backdrop ? undefined : className}
      draggable={false}
    />
  );

  if (backdrop) {
    const pad = Math.round(size * 0.2);
    const outerSize = size + pad * 2;
    return (
      <span
        className={`inline-flex items-center justify-center rounded-full bg-white/90 dark:bg-slate-100/90 shrink-0 ${className ?? ""}`}
        style={{ width: outerSize, height: outerSize }}
        aria-hidden="true"
      >
        {img}
      </span>
    );
  }

  return img;
}

export const K8sIcon = memo(K8sIconInner);
