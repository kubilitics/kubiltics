// Native app menu (R1.4): File, Edit, View, Help
use tauri::menu::{MenuBuilder, PredefinedMenuItem, SubmenuBuilder};

pub fn build_app_menu<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> Result<tauri::menu::Menu<R>, Box<dyn std::error::Error + Send + Sync>> {
    let quit = PredefinedMenuItem::quit(app, Some("Quit"))?;
    let close = PredefinedMenuItem::close_window(app, Some("Close"))?;
    let file_menu = SubmenuBuilder::new(app, "File")
        .item(&close)
        .item(&quit)
        .build()?;

    let cut = PredefinedMenuItem::cut(app, None)?;
    let copy = PredefinedMenuItem::copy(app, None)?;
    let paste = PredefinedMenuItem::paste(app, None)?;
    let edit_menu = SubmenuBuilder::new(app, "Edit")
        .item(&cut)
        .item(&copy)
        .item(&paste)
        .build()?;

    let view_menu = SubmenuBuilder::new(app, "View")
        .text("refresh", "Refresh")
        .build()?;

    let help_menu = SubmenuBuilder::new(app, "Help")
        .text("docs", "Documentation")
        .text("about", "About Kubilitics")
        .build()?;

    let menu = MenuBuilder::new(app)
        .item(&file_menu)
        .item(&edit_menu)
        .item(&view_menu)
        .item(&help_menu)
        .build()?;

    Ok(menu)
}
