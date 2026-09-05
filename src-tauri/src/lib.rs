mod constants;
mod parser;

use parser::{parse_all_sessions, FetchAllStatsResponse};
use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    AppHandle, Manager, PhysicalPosition, PhysicalSize, WebviewWindow,
};

#[tauri::command]
fn get_stats() -> FetchAllStatsResponse {
    parse_all_sessions(150)
}

#[tauri::command]
fn open_dashboard(app: AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
    }
}

#[tauri::command]
fn toggle_mini_widget(app: AppHandle, visible: bool) {
    if let Some(window) = app.get_webview_window("mini") {
        if visible {
            let _ = window.show();
        } else {
            let _ = window.hide();
        }
    }
}

#[tauri::command]
fn resize_mini_widget(app: AppHandle, width: f64) {
    if let Some(window) = app.get_webview_window("mini") {
        if let Ok(Some(monitor)) = window.current_monitor() {
            let monitor_size = monitor.size();
            let scale_factor = monitor.scale_factor();
            let safe_width = (width + 28.0).max(320.0) * scale_factor;
            let height = 46.0 * scale_factor;

            let center_x = ((monitor_size.width as f64 - safe_width) / 2.0).round() as i32;
            let top_y = (4.0 * scale_factor).round() as i32;

            let _ = window.set_size(PhysicalSize::new(safe_width as u32, height as u32));
            let _ = window.set_position(PhysicalPosition::new(center_x, top_y));
        }
    }
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            open_dashboard(app.clone());
        }))
        .setup(|app| {
            // Position mini window at top-center on launch
            if let Some(mini) = app.get_webview_window("mini") {
                if let Ok(Some(monitor)) = mini.primary_monitor() {
                    let monitor_size = monitor.size();
                    let scale_factor = monitor.scale_factor();
                    let width = 400.0 * scale_factor;
                    let height = 46.0 * scale_factor;
                    let center_x = ((monitor_size.width as f64 - width) / 2.0).round() as i32;
                    let top_y = (4.0 * scale_factor).round() as i32;

                    let _ = mini.set_size(PhysicalSize::new(width as u32, height as u32));
                    let _ = mini.set_position(PhysicalPosition::new(center_x, top_y));
                    let _ = mini.show();
                }
            }

            // System Tray Menu Setup
            let dashboard_item = MenuItem::with_id(app, "dashboard", "Open Dashboard", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "Exit AI Token Analytics", true, None::<&str>)?;
            let tray_menu = Menu::with_items(app, &[&dashboard_item, &quit_item])?;

            let _tray = TrayIconBuilder::new()
                .tooltip("AI Token Analytics")
                .menu(&tray_menu)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "dashboard" => open_dashboard(app.clone()),
                    "quit" => app.exit(0),
                    _ => {}
                })
                .build(app)?;

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_stats,
            open_dashboard,
            toggle_mini_widget,
            resize_mini_widget
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
