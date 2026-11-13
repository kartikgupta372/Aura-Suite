// DeskCal desktop shell: one window, a tray icon, local storage, and launch-at-login.
// Reminders run in ui/reminders.js; the window hides to the tray on close so they keep firing.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{fs, path::PathBuf};
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, WindowEvent,
};
use tauri_plugin_autostart::MacosLauncher;

const ALLOWED: [&str; 2] = ["calendar.json", "notified.json"];

fn data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(dir.join("backups")).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn check_name(name: &str) -> Result<(), String> {
    if ALLOWED.contains(&name) { Ok(()) } else { Err("file not allowed".into()) }
}

#[tauri::command]
fn read_store(app: AppHandle, name: String) -> Result<Option<String>, String> {
    check_name(&name)?;
    let path = data_dir(&app)?.join(&name);
    if path.exists() {
        return fs::read_to_string(path).map(Some).map_err(|e| e.to_string());
    }
    // First run: bring over a calendar from the old Node-based DeskCal, if there is one.
    if name == "calendar.json" {
        if let Ok(home) = app.path().home_dir() {
            let legacy = home.join("DeskCal").join("data").join("calendar.json");
            if let Ok(text) = fs::read_to_string(&legacy) {
                if serde_json::from_str::<serde_json::Value>(&text).is_ok() {
                    let _ = fs::write(&path, &text);
                    return Ok(Some(text));
                }
            }
        }
    }
    Ok(None)
}

// Writes atomically (temp file, then rename). `day` is YYYY-MM-DD and names the daily backup.
#[tauri::command]
fn write_store(app: AppHandle, name: String, json: String, day: Option<String>) -> Result<(), String> {
    check_name(&name)?;
    serde_json::from_str::<serde_json::Value>(&json).map_err(|_| "not valid JSON".to_string())?;
    let dir = data_dir(&app)?;
    let tmp = dir.join(format!("{name}.tmp"));
    fs::write(&tmp, &json).map_err(|e| e.to_string())?;
    fs::rename(&tmp, dir.join(&name)).map_err(|e| e.to_string())?;
    if name == "calendar.json" {
        if let Some(d) = day {
            if d.len() == 10 && d.chars().all(|c| c.is_ascii_digit() || c == '-') {
                let _ = fs::write(dir.join("backups").join(format!("calendar-{d}.json")), &json);
            }
        }
    }
    Ok(())
}

fn show_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| show_main(app)))
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, Some(vec!["--hidden"])))
        .invoke_handler(tauri::generate_handler![read_store, write_store])
        .setup(|app| {
            let open = MenuItem::with_id(app, "open", "Open DeskCal", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit (stops reminders)", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open, &quit])?;
            TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("DeskCal")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "open" => show_main(app),
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                        show_main(tray.app_handle());
                    }
                })
                .build(app)?;
            // Started by "launch at login": stay in the tray instead of opening a window.
            if std::env::args().any(|a| a == "--hidden") {
                if let Some(w) = app.get_webview_window("main") { let _ = w.hide(); }
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running DeskCal");
}
