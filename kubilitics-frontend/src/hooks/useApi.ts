import { useBackendClient } from "./useBackendClient";

export function useApi() {
    const { client } = useBackendClient();
    if (!client) {
        // In a real app, this might redirect or show a global error
        // For now, we return a mock-safe or throw if critical
        throw new Error("Backend API client not available. Ensure backend is configured.");
    }
    return client;
}
