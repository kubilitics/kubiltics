use tauri::{AppHandle, Emitter, Manager};
use tauri::tray::{TrayIconBuilder, TrayIconEvent};

pub fn setup_system_tray(app: &AppHandle) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    // Create tray icon menu
    let menu = tauri::menu::MenuBuilder::new(app)
        .text("open", "Open Kubilitics")
        .text("status", "Show Cluster Status")
        .separator()
        .text("quit", "Quit")
        .build()?;

    // Create tray icon with menu event handling
    let _tray = TrayIconBuilder::new()
        .menu(&menu)
        .icon(app.default_window_icon().unwrap().clone())
        .tooltip("Kubilitics - The Kubernetes OS")
        .on_tray_icon_event(|tray, event| {
            match event {
                TrayIconEvent::Click {
                    button: tauri::tray::MouseButton::Left,
                    button_state: _,
                    ..
                } => {
                    // Show window on left click
                    if let Some(window) = tray.app_handle().get_webview_window("main") {
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                }
                _ => {}
            }
        })
        .on_menu_event(|tray, event| {
            match event.id().0.as_str() {
                "open" => {
                    // Show main window
                    if let Some(window) = tray.app_handle().get_webview_window("main") {
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                }
                "status" => {
                    // Emit event to show cluster status
                    let _ = tray.app_handle().emit("tray-show-status", ());
                }
                "quit" => {
                    tray.app_handle().exit(0);
                }
                _ => {}
            }
        })
        .build(app)?;

    Ok(())
}

#[allow(dead_code)]
pub fn update_tray_icon_health(app: &AppHandle, health: &str) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    // Update tray icon based on cluster health
    // health can be: "healthy" (green), "degraded" (amber), "unhealthy" (red)
    // For now, we'll use the default icon - in production, you'd load different icons
    // based on health status
    
    // Emit event that frontend can listen to for updating UI
    let _ = app.emit("tray-health-update", health);
    
    Ok(())
}
