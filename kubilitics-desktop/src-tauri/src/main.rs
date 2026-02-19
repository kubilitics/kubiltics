// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::{Emitter, Manager};

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
            commands::check_for_updates,
            commands::install_update,
            commands::get_desktop_info,
            commands::restart_sidecar,
            commands::is_kcli_sidecar_available,
            sidecar::get_ai_status,
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
            // Start Go backend sidecar (and AI backend if available)
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
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
