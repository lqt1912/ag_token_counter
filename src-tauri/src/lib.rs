mod constants;
mod parser;

use parser::{parse_all_sessions, FetchAllStatsResponse};
use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    AppHandle, Manager, PhysicalPosition, PhysicalSize,
};

#[tauri::command]
fn get_stats() -> FetchAllStatsResponse {
    parse_all_sessions(150)
}

#[tauri::command]
fn open_dashboard(app: AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    } else {
        let app_icon = tauri::include_image!("icons/32x32.png");
        let builder = tauri::WebviewWindowBuilder::new(
            &app,
            "main",
            tauri::WebviewUrl::App("index.html".into()),
        )
        .title("AI Token Analytics")
        .inner_size(1300.0, 880.0)
        .min_inner_size(960.0, 650.0)
        .resizable(true);

        if let Ok(new_win) = builder.build() {
            let _ = new_win.set_icon(app_icon);
            let _ = new_win.show();
            let _ = new_win.set_focus();
        }
    }
}

#[tauri::command]
fn open_data_folder() -> Result<(), String> {
    let store_path = parser::get_data_store_path();
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        let mut cmd = std::process::Command::new("explorer");
        if store_path.exists() {
            cmd.arg(format!("/select,{}", store_path.to_string_lossy()));
        } else if let Some(parent) = store_path.parent() {
            let _ = std::fs::create_dir_all(parent);
            cmd.arg(parent.to_string_lossy().to_string());
        } else {
            cmd.arg(".");
        }
        cmd.creation_flags(0x08000000);
        let _ = cmd.spawn().map_err(|e| format!("Failed to open explorer: {}", e))?;
        Ok(())
    }
    #[cfg(not(target_os = "windows"))]
    {
        Ok(())
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
            let safe_width = (width + 16.0).max(300.0) * scale_factor;
            let height = 32.0 * scale_factor;

            let center_x = ((monitor_size.width as f64 - safe_width) / 2.0).round() as i32;
            let top_y = (4.0 * scale_factor).round() as i32;

            let _ = window.set_size(PhysicalSize::new(safe_width as u32, height as u32));
            let _ = window.set_position(PhysicalPosition::new(center_x, top_y));
            let _ = window.set_shadow(false);
        }
    }
}

const RUN_KEY: &str = r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run";
const APP_NAME: &str = "AITokenAnalytics";

#[tauri::command]
fn get_autostart_status() -> bool {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        let mut cmd = std::process::Command::new("reg");
        cmd.args(["query", RUN_KEY, "/v", APP_NAME]);
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
        match cmd.output() {
            Ok(output) => output.status.success(),
            Err(_) => false,
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        false
    }
}

#[tauri::command]
fn set_autostart(enable: bool) -> Result<bool, String> {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        if enable {
            let current_exe = std::env::current_exe()
                .map_err(|e| format!("Failed to get current executable path: {}", e))?;
            let exe_str = current_exe.to_string_lossy();
            let mut cmd = std::process::Command::new("reg");
            cmd.args([
                "add",
                RUN_KEY,
                "/v",
                APP_NAME,
                "/t",
                "REG_SZ",
                "/d",
                &format!("\"{}\"", exe_str),
                "/f",
            ]);
            cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
            let output = cmd.output().map_err(|e| format!("Failed to execute reg add: {}", e))?;
            if output.status.success() {
                Ok(true)
            } else {
                let err_msg = String::from_utf8_lossy(&output.stderr);
                Err(format!("reg add failed: {}", err_msg))
            }
        } else {
            let mut cmd = std::process::Command::new("reg");
            cmd.args(["delete", RUN_KEY, "/v", APP_NAME, "/f"]);
            cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
            let _ = cmd.output();
            Ok(false)
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        Err("Auto-start is only supported on Windows".into())
    }
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            open_dashboard(app.clone());
        }))
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" {
                    let _ = window.hide();
                    api.prevent_close();
                }
            }
        })
        .setup(|app| {
            // Position mini window at top-center on launch
            if let Some(mini) = app.get_webview_window("mini") {
                if let Ok(Some(monitor)) = mini.primary_monitor() {
                    let monitor_size = monitor.size();
                    let scale_factor = monitor.scale_factor();
                    let width = 380.0 * scale_factor;
                    let height = 32.0 * scale_factor;
                    let center_x = ((monitor_size.width as f64 - width) / 2.0).round() as i32;
                    let top_y = (4.0 * scale_factor).round() as i32;

                    let _ = mini.set_size(PhysicalSize::new(width as u32, height as u32));
                    let _ = mini.set_position(PhysicalPosition::new(center_x, top_y));
                    let _ = mini.set_shadow(false);
                    let _ = mini.show();
                }
            }

            // System Tray Menu Setup
            let dashboard_item = MenuItem::with_id(app, "dashboard", "Open Dashboard", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "Exit AI Token Analytics", true, None::<&str>)?;
            let tray_menu = Menu::with_items(app, &[&dashboard_item, &quit_item])?;

            let app_icon = tauri::include_image!("icons/32x32.png");

            if let Some(main_win) = app.get_webview_window("main") {
                let _ = main_win.set_icon(app_icon.clone());
            }

            let _tray = TrayIconBuilder::new()
                .icon(app_icon)
                .tooltip("AI Token Analytics")
                .menu(&tray_menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "dashboard" => open_dashboard(app.clone()),
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let tauri::tray::TrayIconEvent::Click {
                        button: tauri::tray::MouseButton::Left,
                        button_state: tauri::tray::MouseButtonState::Up,
                        ..
                    } = event
                    {
                        open_dashboard(tray.app_handle().clone());
                    }
                })
                .build(app)?;

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_stats,
            open_dashboard,
            toggle_mini_widget,
            resize_mini_widget,
            get_autostart_status,
            set_autostart,
            open_data_folder
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
