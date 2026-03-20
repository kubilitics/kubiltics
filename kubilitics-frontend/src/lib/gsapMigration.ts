/**
 * GSAP to Framer Motion Migration Guide
 *
 * This file documents all GSAP usage in the codebase and provides equivalent
 * Framer Motion implementations. The goal is to remove the ~30kB GSAP dependency
 * and consolidate all animations on Framer Motion, which is already used
 * extensively throughout the application.
 *
 * ## Current GSAP Usage
 *
 * 1. **Dynamic import wrapper** (`src/lib/bundle-analysis.ts`)
 *    - `loadGsap()` function that dynamically imports GSAP
 *    - Used for onboarding micro-animations
 *
 * 2. **package.json dependency**
 *    - `gsap` is listed as a production dependency
 *
 * ## Migration Strategy
 *
 * GSAP is currently used only via dynamic import for micro-animations,
 * primarily in onboarding flows. Framer Motion already handles all other
 * animations across 100+ components. The migration is straightforward:
 *
 * ### Step 1: Replace GSAP calls with Framer Motion
 * ### Step 2: Remove `loadGsap()` from bundle-analysis.ts
 * ### Step 3: Remove `gsap` from package.json
 * ### Step 4: Verify no remaining imports/references
 */

// ─── GSAP → Framer Motion Equivalents ───────────────────────────────────────

/**
 * GSAP: gsap.to(element, { opacity: 1, duration: 0.5 })
 *
 * Framer Motion equivalent:
 * ```tsx
 * <motion.div
 *   initial={{ opacity: 0 }}
 *   animate={{ opacity: 1 }}
 *   transition={{ duration: 0.5 }}
 * />
 * ```
 */
export const fadeInExample = {
  gsap: `gsap.to(element, { opacity: 1, duration: 0.5 })`,
  framerMotion: `<motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.5 }} />`,
};

/**
 * GSAP: gsap.to(element, { x: 100, duration: 0.3, ease: "power2.out" })
 *
 * Framer Motion equivalent:
 * ```tsx
 * <motion.div
 *   animate={{ x: 100 }}
 *   transition={{ duration: 0.3, ease: [0.33, 1, 0.68, 1] }}
 * />
 * ```
 *
 * Common GSAP easing → Framer Motion cubic bezier:
 *   power1.out → [0.25, 1, 0.5, 1]
 *   power2.out → [0.33, 1, 0.68, 1]
 *   power3.out → [0.22, 1, 0.36, 1]
 *   power2.inOut → [0.65, 0, 0.35, 1]
 *   back.out → [0.34, 1.56, 0.64, 1]
 *   elastic → type: "spring", stiffness: 200, damping: 10
 */
export const slideExample = {
  gsap: `gsap.to(element, { x: 100, duration: 0.3, ease: "power2.out" })`,
  framerMotion: `<motion.div animate={{ x: 100 }} transition={{ duration: 0.3, ease: [0.33, 1, 0.68, 1] }} />`,
};

/**
 * GSAP: gsap.fromTo(element, { scale: 0 }, { scale: 1, duration: 0.5, ease: "back.out(1.7)" })
 *
 * Framer Motion equivalent:
 * ```tsx
 * <motion.div
 *   initial={{ scale: 0 }}
 *   animate={{ scale: 1 }}
 *   transition={{ type: "spring", stiffness: 260, damping: 20 }}
 * />
 * ```
 */
export const scaleExample = {
  gsap: `gsap.fromTo(element, { scale: 0 }, { scale: 1, duration: 0.5, ease: "back.out(1.7)" })`,
  framerMotion: `<motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: "spring", stiffness: 260, damping: 20 }} />`,
};

/**
 * GSAP Timeline:
 * ```js
 * const tl = gsap.timeline();
 * tl.to(el1, { opacity: 1, duration: 0.3 })
 *   .to(el2, { x: 100, duration: 0.3 }, "+=0.1")
 *   .to(el3, { scale: 1, duration: 0.2 });
 * ```
 *
 * Framer Motion equivalent using staggerChildren:
 * ```tsx
 * const containerVariants = {
 *   hidden: {},
 *   visible: {
 *     transition: { staggerChildren: 0.1 },
 *   },
 * };
 *
 * const itemVariants = {
 *   hidden: { opacity: 0, x: -20 },
 *   visible: { opacity: 1, x: 0, transition: { duration: 0.3 } },
 * };
 *
 * <motion.div variants={containerVariants} initial="hidden" animate="visible">
 *   <motion.div variants={itemVariants} />
 *   <motion.div variants={itemVariants} />
 *   <motion.div variants={itemVariants} />
 * </motion.div>
 * ```
 */
export const timelineExample = {
  gsap: `const tl = gsap.timeline(); tl.to(el1, { opacity: 1 }).to(el2, { x: 100 })`,
  framerMotion: `Use variants with staggerChildren for sequential animations`,
};

/**
 * GSAP ScrollTrigger:
 * ```js
 * gsap.to(element, {
 *   scrollTrigger: { trigger: element, start: "top 80%" },
 *   opacity: 1,
 *   y: 0,
 * });
 * ```
 *
 * Framer Motion equivalent using whileInView:
 * ```tsx
 * <motion.div
 *   initial={{ opacity: 0, y: 50 }}
 *   whileInView={{ opacity: 1, y: 0 }}
 *   viewport={{ once: true, margin: "-20%" }}
 *   transition={{ duration: 0.5 }}
 * />
 * ```
 */
export const scrollTriggerExample = {
  gsap: `gsap.to(el, { scrollTrigger: { trigger: el }, opacity: 1 })`,
  framerMotion: `<motion.div whileInView={{ opacity: 1 }} viewport={{ once: true }} />`,
};

// ─── GSAP Easing Map ────────────────────────────────────────────────────────

/**
 * Mapping of common GSAP easing functions to Framer Motion equivalents.
 */
export const GSAP_EASING_MAP: Record<string, number[] | { type: string; stiffness?: number; damping?: number }> = {
  'none':         [0, 0, 1, 1],
  'power1.in':    [0.42, 0, 1, 1],
  'power1.out':   [0, 0, 0.58, 1],
  'power1.inOut': [0.42, 0, 0.58, 1],
  'power2.in':    [0.55, 0.085, 0.68, 0.53],
  'power2.out':   [0.25, 0.46, 0.45, 0.94],
  'power2.inOut': [0.455, 0.03, 0.515, 0.955],
  'power3.in':    [0.895, 0.03, 0.685, 0.22],
  'power3.out':   [0.165, 0.84, 0.44, 1],
  'power3.inOut': [0.77, 0, 0.175, 1],
  'back.in':      [0.6, -0.28, 0.735, 0.045],
  'back.out':     [0.175, 0.885, 0.32, 1.275],
  'back.inOut':   [0.68, -0.55, 0.265, 1.55],
  'elastic.out':  { type: 'spring', stiffness: 200, damping: 10 },
  'bounce.out':   { type: 'spring', stiffness: 300, damping: 20 },
};

// ─── Migration Checklist ────────────────────────────────────────────────────

/**
 * Files that reference GSAP and need to be updated:
 *
 * 1. src/lib/bundle-analysis.ts
 *    - Remove `loadGsap()` function
 *    - Remove `gsap: '~30 kB'` from HEAVY_LIBRARIES
 *    - Update documentation comments referencing GSAP
 *
 * 2. package.json
 *    - Remove "gsap" from dependencies
 *
 * 3. package-lock.json
 *    - Will be updated automatically after removing gsap from package.json
 *
 * 4. src/topology-engine/README.md
 *    - Update any GSAP references in documentation
 *
 * 5. Any component files that use `loadGsap()`:
 *    - Search for: `import.*loadGsap` or `loadGsap()`
 *    - Replace with Framer Motion equivalents per the examples above
 */
export const MIGRATION_CHECKLIST = [
  {
    file: 'src/lib/bundle-analysis.ts',
    action: 'Remove loadGsap() function and GSAP from HEAVY_LIBRARIES',
    status: 'pending' as const,
  },
  {
    file: 'package.json',
    action: 'Remove gsap dependency',
    status: 'pending' as const,
  },
  {
    file: 'src/topology-engine/README.md',
    action: 'Update GSAP references in documentation',
    status: 'pending' as const,
  },
] as const;

/**
 * Bundle size impact of the migration:
 *   - GSAP removal: ~30 kB saved
 *   - Framer Motion is already included: 0 kB added
 *   - Net savings: ~30 kB
 */
export const BUNDLE_IMPACT = {
  removedBytes: 30_000,
  addedBytes: 0,
  netSavingsBytes: 30_000,
  description: 'Removing GSAP saves ~30kB with no additions since Framer Motion is already a dependency.',
} as const;
