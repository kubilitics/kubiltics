import { SVGProps } from 'react';

interface IconProps extends SVGProps<SVGSVGElement> {
  size?: number;
}

export const KubiliticsLogo = ({ size = 24, useGradient = false, ...props }: IconProps & { useGradient?: boolean }) => {
  const gradientId = "kubilitics-logo-gradient";
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 100 100"
      width={size}
      height={size}
      {...props}
    >
      {useGradient && (
        <defs>
          <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#0076DD" />
            <stop offset="100%" stopColor="#00CDE9" />
          </linearGradient>
        </defs>
      )}
      <path
        fill={useGradient ? `url(#${gradientId})` : "currentColor"}
        d="M83.924 24c-4.363 0-7.913 3.55-7.913 7.913 0 1.461.405 2.825 1.098 4.001L64.486 48.536a7.865 7.865 0 00-3.804-.978c-3.191 0-5.942 1.903-7.192 4.631L41.195 49.8c-.803-3.519-3.951-6.154-7.709-6.154-4.363 0-7.913 3.55-7.913 7.913 0 1.309.325 2.543.89 3.631l-7.214 7.216a7.848 7.848 0 00-3.335-.747C11.55 61.658 8 65.208 8 69.571s3.55 7.913 7.913 7.913c4.364 0 7.914-3.55 7.914-7.913a7.837 7.837 0 00-.765-3.371l7.35-7.351c.945.4 1.984.622 3.074.622 3.07 0 5.73-1.76 7.042-4.32l12.538 2.437c.929 3.337 3.988 5.797 7.617 5.797 4.363 0 7.913-3.55 7.913-7.913 0-1.019-.2-1.989-.553-2.885l13.229-13.228c.83.296 1.721.467 2.651.467 4.363 0 7.913-3.55 7.913-7.913S88.287 24 83.924 24zM15.913 72.104a2.536 2.536 0 01-2.533-2.533 2.535 2.535 0 012.533-2.533 2.536 2.536 0 012.534 2.533 2.536 2.536 0 01-2.534 2.533zm17.573-18.012a2.537 2.537 0 01-2.534-2.533c0-1.397 1.137-2.533 2.534-2.533s2.534 1.136 2.534 2.533a2.537 2.537 0 01-2.534 2.533zm27.197 3.913a2.536 2.536 0 01-2.533-2.533 2.535 2.535 0 012.533-2.533 2.536 2.536 0 012.533 2.533 2.537 2.537 0 01-2.533 2.533zm23.241-23.559c-1.397 0-2.533-1.136-2.533-2.533s1.136-2.533 2.533-2.533c1.396 0 2.533 1.136 2.533 2.533s-1.137 2.533-2.533 2.533z"
      />
    </svg>
  );
};

export const KubiliticsText = ({ height = 24, ...props }: SVGProps<SVGSVGElement> & { height?: number }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 317 60"
    height={height}
    width="auto"
    className="aspect-[317/60]"
    {...props}
  >
    <path
      fill="currentColor"
      transform="matrix(5.94, 0, 0, 5.94, -6.95, -19.24)"
      d="M6.90 13.15L8.79 13.15L4.72 7.74L8.34 3.82L6.46 3.82L2.65 8.04L2.65 3.82L1.17 3.82L1.17 13.15L2.65 13.15L2.65 9.99L3.75 8.81ZM13.90 6.53L13.90 10.57C13.78 11.74 12.99 12.12 12.25 12.12C11.23 12.12 10.79 11.39 10.79 10.31L10.79 6.53L9.38 6.53L9.38 10.63C9.38 12.69 10.70 13.33 11.86 13.33C12.79 13.33 13.50 12.95 13.90 12.37L14.07 13.15L15.31 13.15L15.31 6.53ZM20.66 6.36C19.72 6.36 18.99 6.72 18.48 7.32L18.48 3.24L17.06 3.24L17.06 13.15L18.21 13.15L18.39 12.25C18.90 12.91 19.67 13.31 20.66 13.31C22.39 13.31 23.76 12.00 23.76 9.84C23.76 7.69 22.39 6.36 20.66 6.36ZM20.33 12.12C19.09 12.12 18.29 11.14 18.29 9.84C18.29 8.55 19.09 7.55 20.33 7.55C21.52 7.55 22.31 8.55 22.31 9.84C22.31 11.14 21.52 12.12 20.33 12.12ZM26.02 5.26C26.53 5.26 26.94 4.86 26.94 4.36C26.94 3.86 26.53 3.46 26.02 3.46C25.51 3.46 25.10 3.86 25.10 4.36C25.10 4.86 25.51 5.26 26.02 5.26ZM25.33 13.15L26.72 13.15L26.72 6.53L25.33 6.53ZM28.70 13.15L30.11 13.15L30.11 3.24L28.70 3.24ZM32.78 5.26C33.29 5.26 33.70 4.86 33.70 4.36C33.70 3.86 33.29 3.46 32.78 3.46C32.27 3.46 31.86 3.86 31.86 4.36C31.86 4.86 32.27 5.26 32.78 5.26ZM32.10 13.15L33.48 13.15L33.48 6.53L32.10 6.53ZM38.49 11.93C38.40 11.99 38.16 12.06 37.89 12.06C37.44 12.06 37.16 11.80 37.16 11.20L37.16 7.67L38.56 7.67L38.56 6.53L37.16 6.53L37.16 4.64L35.74 4.64L35.74 6.53L34.87 6.53L34.87 7.67L35.74 7.67L35.74 11.32C35.74 12.91 36.74 13.27 37.55 13.27C38.08 13.27 38.50 13.17 38.67 13.08ZM40.72 5.26C41.23 5.26 41.64 4.86 41.64 4.36C41.64 3.86 41.23 3.46 40.72 3.46C40.21 3.46 39.80 3.86 39.80 4.36C39.80 4.86 40.21 5.26 40.72 5.26ZM40.03 13.15L41.42 13.15L41.42 6.53L40.03 6.53ZM46.46 13.34C47.38 13.34 48.12 13.07 48.74 12.60L47.92 11.58C47.56 11.93 47.05 12.13 46.49 12.13C45.19 12.13 44.42 11.14 44.42 9.84C44.42 8.55 45.19 7.57 46.49 7.57C47.05 7.57 47.56 7.77 47.92 8.12L48.74 7.10C48.12 6.64 47.38 6.36 46.46 6.36C44.41 6.36 42.98 7.89 42.98 9.84C42.98 11.81 44.41 13.34 46.46 13.34ZM49.19 12.22C49.67 12.88 50.68 13.34 51.92 13.34C53.55 13.34 54.56 12.54 54.56 11.35C54.56 9.00 51.06 9.79 51.06 8.36C51.06 7.86 51.44 7.53 52.21 7.51C52.69 7.50 53.24 7.73 53.64 8.11L54.41 7.22C53.97 6.75 53.13 6.36 52.15 6.36C50.57 6.36 49.61 7.19 49.61 8.41C49.61 10.82 53.05 10.09 53.05 11.38C53.05 11.87 52.65 12.21 51.83 12.21C51.17 12.21 50.57 11.97 50.09 11.35Z"
    />
  </svg>
);

export const KubernetesLogo = KubiliticsLogo;

export const PodIcon = ({ size = 20, ...props }: IconProps) => (
  <svg viewBox="0 0 24 24" width={size} height={size} {...props}>
    <path
      fill="currentColor"
      d="M12 2L2 7v10l10 5 10-5V7L12 2zm0 2.18l6.9 3.45L12 11.09 5.1 7.63 12 4.18zM4 8.82l7 3.5v6.86l-7-3.5V8.82zm16 6.86l-7 3.5v-6.86l7-3.5v6.86z"
    />
  </svg>
);

export const DeploymentIcon = ({ size = 20, ...props }: IconProps) => (
  <svg viewBox="0 0 24 24" width={size} height={size} {...props}>
    <path
      fill="currentColor"
      d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-7 14l-5-5 1.41-1.41L12 14.17l4.59-4.58L18 11l-6 6z"
    />
  </svg>
);

export const ServiceIcon = ({ size = 20, ...props }: IconProps) => (
  <svg viewBox="0 0 24 24" width={size} height={size} {...props}>
    <path
      fill="currentColor"
      d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"
    />
  </svg>
);

export const NodeIcon = ({ size = 20, ...props }: IconProps) => (
  <svg viewBox="0 0 24 24" width={size} height={size} {...props}>
    <path
      fill="currentColor"
      d="M20 2H4c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-8 16c-2.21 0-4-1.79-4-4s1.79-4 4-4 4 1.79 4 4-1.79 4-4 4zm0-6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zM6 8V6h2v2H6zm0 4v-2h2v2H6zm4-4V6h2v2h-2zm8 0h-2V6h2v2z"
    />
  </svg>
);

export const NamespaceIcon = ({ size = 20, ...props }: IconProps) => (
  <svg viewBox="0 0 24 24" width={size} height={size} {...props}>
    <path
      fill="currentColor"
      d="M3 3h8v8H3V3zm2 2v4h4V5H5zm8-2h8v8h-8V3zm2 2v4h4V5h-4zM3 13h8v8H3v-8zm2 2v4h4v-4H5zm8-2h8v8h-8v-8zm2 2v4h4v-4h-4z"
    />
  </svg>
);

export const IngressIcon = ({ size = 20, ...props }: IconProps) => (
  <svg viewBox="0 0 24 24" width={size} height={size} {...props}>
    <path
      fill="currentColor"
      d="M12 2L4 5v6.09c0 5.05 3.41 9.76 8 10.91 4.59-1.15 8-5.86 8-10.91V5l-8-3zm-1 6h2v2h-2V8zm0 4h2v6h-2v-6z"
    />
  </svg>
);

export const ConfigMapIcon = ({ size = 20, ...props }: IconProps) => (
  <svg viewBox="0 0 24 24" width={size} height={size} {...props}>
    <path
      fill="currentColor"
      d="M19.43 12.98c.04-.32.07-.64.07-.98s-.03-.66-.07-.98l2.11-1.65c.19-.15.24-.42.12-.64l-2-3.46c-.12-.22-.39-.3-.61-.22l-2.49 1c-.52-.4-1.08-.73-1.69-.98l-.38-2.65C14.46 2.18 14.25 2 14 2h-4c-.25 0-.46.18-.49.42l-.38 2.65c-.61.25-1.17.59-1.69.98l-2.49-1c-.23-.09-.49 0-.61.22l-2 3.46c-.13.22-.07.49.12.64l2.11 1.65c-.04.32-.07.65-.07.98s.03.66.07.98l-2.11 1.65c-.19.15-.24.42-.12.64l2 3.46c.12.22.39.3.61.22l2.49-1c.52.4 1.08.73 1.69.98l.38 2.65c.03.24.24.42.49.42h4c.25 0 .46-.18.49-.42l.38-2.65c.61-.25 1.17-.59 1.69-.98l2.49 1c.23.09.49 0 .61-.22l2-3.46c.12-.22.07-.49-.12-.64l-2.11-1.65zM12 15.5c-1.93 0-3.5-1.57-3.5-3.5s1.57-3.5 3.5-3.5 3.5 1.57 3.5 3.5-1.57 3.5-3.5 3.5z"
    />
  </svg>
);

export const SecretIcon = ({ size = 20, ...props }: IconProps) => (
  <svg viewBox="0 0 24 24" width={size} height={size} {...props}>
    <path
      fill="currentColor"
      d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z"
    />
  </svg>
);

export const StorageIcon = ({ size = 20, ...props }: IconProps) => (
  <svg viewBox="0 0 24 24" width={size} height={size} {...props}>
    <path
      fill="currentColor"
      d="M2 20h20v-4H2v4zm2-3h2v2H4v-2zM2 4v4h20V4H2zm4 3H4V5h2v2zm-4 7h20v-4H2v4zm2-3h2v2H4v-2z"
    />
  </svg>
);

export const ClusterIcon = ({ size = 20, ...props }: IconProps) => (
  <svg viewBox="0 0 24 24" width={size} height={size} {...props}>
    <path
      fill="currentColor"
      d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"
    />
  </svg>
);

export const ReplicaSetIcon = ({ size = 20, ...props }: IconProps) => (
  <svg viewBox="0 0 24 24" width={size} height={size} {...props}>
    <path fill="currentColor" d="M4 4h4v4H4V4zm6 0h4v4h-4V4zm6 0h4v4h-4V4zM4 10h4v4H4v-4zm6 0h4v4h-4v-4zm6 0h4v4h-4v-4zM4 16h4v4H4v-4zm6 0h4v4h-4v-4zm6 0h4v4h-4v-4z" />
  </svg>
);

export const StatefulSetIcon = ({ size = 20, ...props }: IconProps) => (
  <svg viewBox="0 0 24 24" width={size} height={size} {...props}>
    <path fill="currentColor" d="M4 5v14h16V5H4zm14 12H6V7h12v10zM8 9h2v2H8V9zm4 0h2v2h-2V9zm4 0h2v2h-2V9zM8 13h2v2H8v-2zm4 0h2v2h-2v-2zm4 0h2v2h-2v-2z" />
  </svg>
);

export const DaemonSetIcon = ({ size = 20, ...props }: IconProps) => (
  <svg viewBox="0 0 24 24" width={size} height={size} {...props}>
    <path fill="currentColor" d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm-5-9h10v2H7v-2z" />
  </svg>
);

export const JobIcon = ({ size = 20, ...props }: IconProps) => (
  <svg viewBox="0 0 24 24" width={size} height={size} {...props}>
    <path fill="currentColor" d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-7 14l-5-5 1.41-1.41L12 14.17l4.59-4.58L18 11l-6 6z" />
  </svg>
);

export const CronJobIcon = ({ size = 20, ...props }: IconProps) => (
  <svg viewBox="0 0 24 24" width={size} height={size} {...props}>
    <path fill="currentColor" d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67V7z" />
  </svg>
);

export const VolumeSnapshotIcon = ({ size = 20, ...props }: IconProps) => (
  <svg viewBox="0 0 24 24" width={size} height={size} {...props}>
    <path fill="currentColor" d="M12 15.2c1.77 0 3.2-1.43 3.2-3.2S13.77 8.8 12 8.8 8.8 10.23 8.8 12s1.43 3.2 3.2 3.2zM9 2L7.17 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2h-3.17L15 2H9zm3 15c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5z" />
  </svg>
);
