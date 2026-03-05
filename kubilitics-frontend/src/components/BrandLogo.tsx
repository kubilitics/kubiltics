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
}

export function BrandLogo({
  className,
  height = 32,
  variant = 'dark',
  ...imgProps
}: BrandLogoProps) {
  const src = variant === 'dark' ? '/brand/logo-dark.png' : '/brand/logo.png';

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

