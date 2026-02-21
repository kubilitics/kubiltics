/**
 * Mock Tauri invoke for browser-mode development (TAURI_BUILD not set).
 * Each command returns the same shape as the real Rust implementation so
 * callers never crash on null.field access.
 */

export const invoke = async (cmd: string, _args?: unknown): Promise<unknown> => {
    console.log(`[Mock Tauri] invoke: ${cmd}`, _args);

    switch (cmd) {
        // ── Sidecar status ──────────────────────────────────────────────
        case 'get_backend_status':
            return { status: 'ready', message: 'Mock backend ready' };

        case 'get_ai_status':
            return { available: false, running: false, port: 8081 };

        case 'is_kcli_sidecar_available':
            return false;

        // ── First-launch & analytics ────────────────────────────────────
        case 'is_first_launch':
            return true;

        case 'mark_first_launch_complete':
            return;

        case 'has_analytics_consent_been_asked':
            return false;

        case 'get_analytics_consent':
            return false;

        case 'set_analytics_consent':
            return;

        // ── Kubeconfig ──────────────────────────────────────────────────
        case 'get_kubeconfig_info':
            return {
                path: '~/.kube/config',
                current_context: undefined,
                contexts: [],
            };

        case 'read_kubeconfig':
            return null;

        case 'switch_context':
            return;

        case 'validate_kubeconfig':
            return { valid: true, error: null };

        case 'auto_detect_kubeconfig':
            return { path: '~/.kube/config', found: false };

        case 'browse_for_kubeconfig':
            return null;

        case 'select_kubeconfig_file':
            return null;

        case 'get_selected_contexts':
            return [];

        case 'save_selected_contexts':
            return;

        case 'save_custom_kubeconfig_path':
            return;

        case 'get_custom_kubeconfig_path':
            return null;

        case 'encrypt_kubeconfig':
            return null;

        case 'decrypt_kubeconfig':
            return null;

        case 'save_encrypted_kubeconfig':
            return;

        case 'load_encrypted_kubeconfig':
            return null;

        // ── Desktop info & updates ──────────────────────────────────────
        case 'get_desktop_info':
            return {
                app_version: '0.0.0-browser',
                backend_port: 819,
                backend_version: null,
                backend_uptime_seconds: null,
                kubeconfig_path: '~/.kube/config',
                app_data_dir: '/tmp/kubilitics',
            };

        case 'check_for_updates':
            return null;

        case 'install_update':
            return;

        case 'check_connectivity':
            return { reachable: true };

        // ── File system / export ────────────────────────────────────────
        case 'save_topology_export':
            return;

        case 'open_in_system_editor':
            return;

        case 'reveal_in_file_manager':
            return;

        case 'get_recent_exports':
            return [];

        case 'get_app_data_dir':
            return '/tmp/kubilitics';

        // ── Sidecar control ─────────────────────────────────────────────
        case 'restart_sidecar':
            return;

        case 'is_kcli_sidecar_available':
            return false;

        // ── Analytics / misc ────────────────────────────────────────────
        case 'get_analytics_consent':
            return false;

        default:
            console.warn(`[Mock Tauri] Unhandled invoke command: "${cmd}" — returning null`);
            return null;
    }
};
