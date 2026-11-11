#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::Serialize;
use serde_json::Value;
use shixu_storage::{Database, Snapshot};
use std::{fs, io::Write, path::PathBuf, sync::Mutex};
use tauri::{Manager, State};
use tauri_plugin_clipboard_manager::ClipboardExt;
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;

struct AppData {
    db: Mutex<Database>,
    data_dir: PathBuf,
    backup_dir: PathBuf,
    backup_warning: Option<String>,
}
type CmdResult<T> = Result<T, String>;
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DataInfo {
    directory: String,
    database: String,
    backups: String,
    backup_warning: Option<String>,
}
#[derive(Serialize)]
struct SelectedFile {
    name: String,
    bytes: Vec<u8>,
}

#[tauri::command]
fn load_workspace(state: State<'_, AppData>) -> CmdResult<Snapshot> {
    state
        .db
        .lock()
        .map_err(|_| "数据库正忙".to_string())?
        .load()
        .map_err(|e| e.to_string())
}
#[tauri::command]
fn save_workspace(
    state: State<'_, AppData>,
    payload: Value,
    expected_revision: i64,
    protect_restore: bool,
) -> CmdResult<i64> {
    let mut db = state.db.lock().map_err(|_| "数据库正忙".to_string())?;
    db.backup_if_new_day(&state.backup_dir)
        .map_err(|e| e.to_string())?;
    if protect_restore {
        db.automatic_backup(&state.backup_dir, "before-json-restore")
            .map_err(|e| e.to_string())?;
    }
    db.save(&payload, expected_revision)
        .map_err(|e| e.to_string())
}
#[tauri::command]
fn data_info(state: State<'_, AppData>) -> CmdResult<DataInfo> {
    let db = state.db.lock().map_err(|_| "数据库正忙".to_string())?;
    Ok(DataInfo {
        directory: state.data_dir.display().to_string(),
        database: db.path().display().to_string(),
        backups: state.backup_dir.display().to_string(),
        backup_warning: state.backup_warning.clone(),
    })
}
#[tauri::command]
fn open_data_directory(app: tauri::AppHandle, state: State<'_, AppData>) -> CmdResult<()> {
    app.opener()
        .open_path(state.data_dir.to_string_lossy().into_owned(), None::<&str>)
        .map_err(|e| e.to_string())
}
#[tauri::command]
fn open_external(app: tauri::AppHandle, url: String) -> CmdResult<()> {
    let lower = url.to_ascii_lowercase();
    if !lower.starts_with("https://") && !lower.starts_with("http://") {
        return Err("只允许打开 http 或 https 链接".into());
    }
    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|e| e.to_string())
}
#[tauri::command]
fn copy_content(app: tauri::AppHandle, text: String, html: Option<String>) -> CmdResult<()> {
    if let Some(html) = html {
        app.clipboard()
            .write_html(html, Some(text))
            .map_err(|e| e.to_string())
    } else {
        app.clipboard().write_text(text).map_err(|e| e.to_string())
    }
}
#[tauri::command]
async fn select_import_file(
    app: tauri::AppHandle,
    kind: String,
) -> CmdResult<Option<SelectedFile>> {
    tauri::async_runtime::spawn_blocking(move || {
        let dialog = app.dialog().file();
        let selected = match kind.as_str() {
            "csv" => dialog.add_filter("任务 CSV", &["csv"]),
            "json" => dialog.add_filter("JSON 备份", &["json"]),
            _ => return Err("文件类型无效".into()),
        }
        .blocking_pick_file();
        let Some(file) = selected else {
            return Ok(None);
        };
        let path = file.into_path().map_err(|e| e.to_string())?;
        if fs::metadata(&path).map_err(|e| e.to_string())?.len() > 20 * 1024 * 1024 {
            return Err("文件不能超过 20 MB".into());
        }
        let bytes = fs::read(&path).map_err(|e| e.to_string())?;
        Ok(Some(SelectedFile {
            name: path
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .into(),
            bytes,
        }))
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
async fn export_file(app: tauri::AppHandle, name: String, content: String) -> CmdResult<bool> {
    tauri::async_runtime::spawn_blocking(move || {
        let safe_name = PathBuf::from(name)
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .into_owned();
        let Some(file) = app
            .dialog()
            .file()
            .set_file_name(safe_name)
            .blocking_save_file()
        else {
            return Ok(false);
        };
        let path = file.into_path().map_err(|e| e.to_string())?;
        // Do not let a text export overwrite the live database or its WAL.
        let state = app.state::<AppData>();
        if path.starts_with(&state.data_dir) {
            return Err("请导出到应用数据目录以外的位置".into());
        }
        let parent = path.parent().ok_or("导出路径无效")?;
        let mut file = tempfile::NamedTempFile::new_in(parent).map_err(|e| e.to_string())?;
        file.write_all(content.as_bytes())
            .map_err(|e| e.to_string())?;
        file.as_file().sync_all().map_err(|e| e.to_string())?;
        file.persist(path).map_err(|e| e.to_string())?;
        Ok(true)
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
async fn backup_database(app: tauri::AppHandle) -> CmdResult<bool> {
    tauri::async_runtime::spawn_blocking(move || {
        let Some(file) = app
            .dialog()
            .file()
            .set_file_name("拾序数据库备份.sqlite")
            .add_filter("SQLite 备份", &["sqlite"])
            .blocking_save_file()
        else {
            return Ok(false);
        };
        let path = file.into_path().map_err(|e| e.to_string())?;
        let state = app.state::<AppData>();
        if path.starts_with(&state.data_dir) {
            return Err("请将备份保存到应用数据目录以外的位置".into());
        }
        state
            .db
            .lock()
            .map_err(|_| "数据库正忙".to_string())?
            .backup(&path)
            .map_err(|e| e.to_string())?;
        Ok(true)
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
async fn restore_database(
    app: tauri::AppHandle,
    expected_revision: i64,
) -> CmdResult<Option<Snapshot>> {
    tauri::async_runtime::spawn_blocking(move || {
        let Some(file) = app
            .dialog()
            .file()
            .add_filter("SQLite 备份", &["sqlite", "db"])
            .blocking_pick_file()
        else {
            return Ok(None);
        };
        let path = file.into_path().map_err(|e| e.to_string())?;
        let state = app.state::<AppData>();
        let mut db = state.db.lock().map_err(|_| "数据库正忙".to_string())?;
        db.restore(&path, expected_revision, &state.backup_dir)
            .map_err(|e| e.to_string())?;
        Ok(Some(db.load().map_err(|e| e.to_string())?))
    })
    .await
    .map_err(|e| e.to_string())?
}
fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            let backup_dir = data_dir.join("backups");
            fs::create_dir_all(&data_dir)?;
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                fs::set_permissions(&data_dir, fs::Permissions::from_mode(0o700))?;
            }
            let db = Database::open(data_dir.join("shixu.sqlite"))?;
            let backup_warning = db
                .backup_if_new_day(&backup_dir)
                .err()
                .map(|e| e.to_string());
            app.manage(AppData {
                db: Mutex::new(db),
                data_dir,
                backup_dir,
                backup_warning,
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            load_workspace,
            save_workspace,
            data_info,
            open_data_directory,
            open_external,
            copy_content,
            select_import_file,
            export_file,
            backup_database,
            restore_database
        ])
        .run(tauri::generate_context!())
        .expect("拾序启动失败，请检查应用数据目录权限与数据库文件");
}
