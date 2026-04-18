// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

// Compile-time safety: release builds must never enable the devtools Cargo
// feature. If someone ever flips it on in Cargo.toml, the release build will
// fail loudly instead of silently shipping the WebView inspector to users.
#[cfg(all(not(debug_assertions), feature = "devtools"))]
compile_error!("the 'devtools' Cargo feature must not be enabled in release builds");

use tauri::{Emitter, Manager, RunEvent};

mod backend_ports;
mod commands;
mod menu;
mod sidecar;
mod tray;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .invoke_handler(tauri::generate_handler![
            commands::read_kubeconfig,
            commands::get_kubeconfig_info,
            commands::switch_context,
            commands::validate_kubeconfig,
            commands::auto_detect_kubeconfig,
            commands::browse_for_kubeconfig,
            commands::save_topology_export,
            commands::open_in_system_editor,
            commands::reveal_in_file_manager,
            commands::get_recent_exports,
            commands::get_app_data_dir,
            commands::select_kubeconfig_file,
            commands::get_selected_contexts,
            commands::save_selected_contexts,
            commands::is_first_launch,
            commands::mark_first_launch_complete,
            commands::save_custom_kubeconfig_path,
            commands::get_custom_kubeconfig_path,
            commands::encrypt_kubeconfig,
            commands::decrypt_kubeconfig,
            commands::save_encrypted_kubeconfig,
            commands::load_encrypted_kubeconfig,
            commands::check_connectivity,
            commands::get_analytics_consent,
            commands::set_analytics_consent,
            commands::has_analytics_consent_been_asked,
            // Auto-updates handled by tauri-plugin-updater (not custom commands)
            commands::get_desktop_info,
            commands::restart_sidecar,
            commands::is_kcli_sidecar_available,
            sidecar::get_backend_status,
        ])
        .setup(|app| {
            let handle = app.handle().clone();

            // Native menu (R1.4): File, Edit, View, Help
            if let Ok(menu) = menu::build_app_menu(&handle) {
                let _ = app.set_menu(menu.clone());
                app.on_menu_event(move |app_handle, event| {
                    match event.id().0.as_str() {
                        "refresh" => {
                            let _ = app_handle.emit("menu-refresh", ());
                        }
                        "reload" | "force_reload" => {
                            // Reload the main webview window. Force reload cache-busts the
                            // top-level HTML so a stale HMR module cannot stick around, but
                            // preserves existing query params and hash (URL state like tabs,
                            // filters, pagination, returnUrl is encoded there and shouldn't
                            // be nuked by a reload).
                            if let Some(window) = app_handle.get_webview_window("main") {
                                let script = if event.id().0.as_str() == "force_reload" {
                                    "(function(){var u=new URL(location.href);u.searchParams.set('_',Date.now());location.href=u.toString();})()"
                                } else {
                                    "window.location.reload()"
                                };
                                let _ = window.eval(script);
                            }
                        }
                        "docs" => {
                            let _ = app_handle.emit("menu-docs", ());
                        }
                        "about" => {
                            let _ = app_handle.emit("menu-about", ());
                        }
                        _ => {}
                    }
                });
            }
            // Start Go backend sidecar
            sidecar::start_backend(&handle)?;
            
            // Setup system tray
            if let Err(e) = tray::setup_system_tray(&handle) {
                eprintln!("Failed to setup system tray: {}", e);
            }
            
            // Configure window to minimize to tray instead of closing
            if let Some(window) = app.get_webview_window("main") {
                let window_clone = window.clone();
                window.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        // Hide window instead of closing
                        window_clone.hide().unwrap();
                        api.prevent_close();
                    }
                });
            }
            
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            // ROOT CAUSE E: Stop backend sidecar cleanly on any app exit (Force Quit, cmd+Q,
            // tray Quit). Without this the Go process becomes an orphan after the Tauri shell dies.
            if let RunEvent::Exit = event {
                if let Some(manager) = app_handle.try_state::<std::sync::Arc<sidecar::BackendManager>>() {
                    tauri::async_runtime::block_on(manager.stop());
                }
            }
        });
}
