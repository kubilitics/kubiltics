import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

// Headlamp/Lens model: no login. authRequired can be set from backend when auth_mode=required.
// logout() is a no-op; kept for backendApiClient 401 handling (redirect to /).
interface AuthState {
    authRequired: boolean;
    setAuthRequired: (required: boolean) => void;
    logout: () => void;
}

export const useAuthStore = create<AuthState>()(
    persist(
        (set) => ({
            authRequired: false,
            setAuthRequired: (required) => set({ authRequired: required }),
            logout: () => {}, // No-op; 401 handler still calls this before redirect to /
        }),
        {
            name: 'kubilitics-auth',
            storage: createJSONStorage(() => sessionStorage),
            partialize: (state) => ({ authRequired: state.authRequired }),
        }
    )
);
