import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { safeLocalStorage } from '@/lib/safeStorage';

interface OnboardingState {
  /** Whether the user has completed the full onboarding flow (welcome + mode selection) */
  hasCompletedWelcome: boolean;
  /** Whether the user has completed the dashboard tour */
  hasCompletedTour: boolean;
  /** Mark the onboarding as completed */
  completeWelcome: () => void;
  /** Mark the dashboard tour as completed */
  completeTour: () => void;
  /** Reset onboarding state (for Settings → "Replay Tour") */
  resetOnboarding: () => void;
}

export const useOnboardingStore = create<OnboardingState>()(
  persist(
    (set) => ({
      hasCompletedWelcome: false,
      hasCompletedTour: false,
      completeWelcome: () => set({ hasCompletedWelcome: true }),
      completeTour: () => set({ hasCompletedTour: true }),
      resetOnboarding: () => set({ hasCompletedWelcome: false, hasCompletedTour: false }),
    }),
    { name: 'kubilitics-onboarding', storage: createJSONStorage(() => safeLocalStorage) }
  )
);
