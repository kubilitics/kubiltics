import type { ImgHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

type BrandLogoVariant = 'light' | 'dark';

interface BrandLogoProps extends ImgHTMLAttributes<HTMLImageElement> {
  /**
   * Pixel height for the rendered logo.
   * Width scales proportionally.
   */
  height?: number;
  /**
   * Background context:
   * - 'dark' → transparent PNG for dark backgrounds
   * - 'light' → solid-background PNG for light backgrounds
   */
  variant?: BrandLogoVariant;
  /**
   * When true, renders only the icon mark (no wordmark text).
   * Uses the cropped hexagonal icon with rounded corners.
   */
  mark?: boolean;
}

export function BrandLogo({
  className,
  height = 32,
  variant = 'dark',
  mark = false,
  ...imgProps
}: BrandLogoProps) {
  const src = mark
    ? '/brand/logo-mark-rounded.png'
    : variant === 'dark'
      ? '/brand/logo-dark.png'
      : '/brand/logo.png';

  return (
    <img
      src={src}
      alt="Kubilitics"
      style={{ height }}
      className={cn('block h-auto w-auto select-none', className)}
      {...imgProps}
    />
  );
}
