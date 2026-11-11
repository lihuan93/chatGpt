//! SQLite persistence independent of the desktop runtime, so transactions and
//! restore behavior can be tested without a WebView or macOS SDK.
use rusqlite::{params, Connection, OpenFlags, TransactionBehavior};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::HashSet,
    fs,
    path::{Path, PathBuf},
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum Error {
    #[error("数据库操作失败：{0}")]
    Sql(#[from] rusqlite::Error),
    #[error("文件操作失败：{0}")]
    Io(#[from] std::io::Error),
    #[error("数据格式无效：{0}")]
    Json(#[from] serde_json::Error),
    #[error("数据已被其他操作修改，请重新加载后再保存")]
    Conflict,
    #[error("{0}")]
    Invalid(String),
}
pub type Result<T> = std::result::Result<T, Error>;
#[derive(Debug, Serialize, Deserialize)]
pub struct Snapshot {
    pub workspace: Value,
    pub revision: i64,
}
pub struct Database {
    conn: Connection,
    path: PathBuf,
}
const SCHEMA: i64 = 1;
const SQL: &str = r#"
CREATE TABLE meta (singleton INTEGER PRIMARY KEY CHECK(singleton=1), revision INTEGER NOT NULL);
INSERT INTO meta VALUES(1,0);
CREATE TABLE projects (id TEXT PRIMARY KEY, position INTEGER NOT NULL, name TEXT NOT NULL, payload TEXT NOT NULL CHECK(json_valid(payload)));
CREATE TABLE tasks (id TEXT PRIMARY KEY, position INTEGER NOT NULL, project_id TEXT NOT NULL REFERENCES projects(id), source TEXT, source_id TEXT, status TEXT NOT NULL, priority TEXT NOT NULL, completed_at TEXT, payload TEXT NOT NULL CHECK(json_valid(payload)));
CREATE UNIQUE INDEX tasks_source_id ON tasks(source,source_id) WHERE source <> '' AND source_id <> '';
CREATE INDEX tasks_by_project ON tasks(project_id);
CREATE INDEX tasks_by_completion ON tasks(completed_at);
CREATE TABLE records (id TEXT PRIMARY KEY, position INTEGER NOT NULL, task_id TEXT NOT NULL REFERENCES tasks(id), date TEXT NOT NULL, career INTEGER NOT NULL, payload TEXT NOT NULL CHECK(json_valid(payload)));
CREATE INDEX records_by_task_date ON records(task_id,date);
CREATE INDEX career_records ON records(career,date);
CREATE TABLE reports (id TEXT PRIMARY KEY, position INTEGER NOT NULL, start_date TEXT NOT NULL, end_date TEXT NOT NULL, payload TEXT NOT NULL CHECK(json_valid(payload)));
CREATE TABLE report_tasks (report_id TEXT NOT NULL REFERENCES reports(id), row_id TEXT NOT NULL, task_id TEXT NOT NULL REFERENCES tasks(id), PRIMARY KEY(report_id,row_id,task_id));
CREATE TABLE imports (id TEXT PRIMARY KEY, position INTEGER NOT NULL, payload TEXT NOT NULL CHECK(json_valid(payload)));
PRAGMA user_version=1;
"#;
fn text<'a>(value: &'a Value, key: &str) -> &'a str {
    value.get(key).and_then(Value::as_str).unwrap_or("")
}
fn array<'a>(value: &'a Value, key: &str) -> Result<&'a Vec<Value>> {
    value
        .get(key)
        .and_then(Value::as_array)
        .ok_or_else(|| Error::Invalid(format!("缺少数组：{key}")))
}
fn fail(message: &str) -> Error {
    Error::Invalid(message.into())
}
fn valid_date(value: &str) -> bool {
    let bytes = value.as_bytes();
    if bytes.len() != 10
        || bytes[4] != b'-'
        || bytes[7] != b'-'
        || !bytes
            .iter()
            .enumerate()
            .all(|(i, b)| i == 4 || i == 7 || b.is_ascii_digit())
    {
        return false;
    }
    let year: u32 = value[..4].parse().unwrap_or(0);
    let month: u32 = value[5..7].parse().unwrap_or(0);
    let day: u32 = value[8..].parse().unwrap_or(0);
    let leap = year % 4 == 0 && (year % 100 != 0 || year % 400 == 0);
    let max = match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 => {
            if leap {
                29
            } else {
                28
            }
        }
        _ => 0,
    };
    year > 0 && day > 0 && day <= max
}
fn url(value: &str) -> bool {
    value.is_empty()
        || value.to_ascii_lowercase().starts_with("https://")
        || value.to_ascii_lowercase().starts_with("http://")
}
fn strings(value: &Value, keys: &[&str], limit: usize) -> bool {
    keys.iter().all(|key| match value.get(*key) {
        None | Some(Value::Null) => true,
        Some(Value::String(s)) => s.encode_utf16().count() <= limit,
        _ => false,
    })
}
pub fn validate(v: &Value) -> Result<()> {
    if v.get("version").and_then(Value::as_i64) != Some(2) {
        return Err(fail("仅支持第二版工作台数据"));
    }
    if serde_json::to_vec(v)?.len() > 20 * 1024 * 1024 {
        return Err(fail("数据超过 20 MB，暂不能保存"));
    }
    for key in ["projects", "tasks", "records", "reports", "imports"] {
        let rows = array(v, key)?;
        let mut ids = HashSet::new();
        if rows.len() > 20000 {
            return Err(fail("数据条目过多"));
        }
        for item in rows {
            let id = text(item, "id");
            if !item.is_object()
                || id.is_empty()
                || id.encode_utf16().count() > 200
                || !ids.insert(id)
            {
                return Err(fail("存在空 ID 或重复 ID"));
            }
        }
    }
    let projects: HashSet<_> = array(v, "projects")?
        .iter()
        .map(|p| text(p, "id"))
        .collect();
    let tasks: HashSet<_> = array(v, "tasks")?.iter().map(|p| text(p, "id")).collect();
    let mut source_ids = HashSet::new();
    for p in array(v, "projects")? {
        if text(p, "name").trim().is_empty()
            || !strings(p, &["name"], 200)
            || !strings(p, &["description"], 20000)
        {
            return Err(fail("项目名称为空"));
        }
    }
    for t in array(v, "tasks")? {
        if !strings(t, &["title"], 2000)
            || !strings(
                t,
                &[
                    "description",
                    "module",
                    "tags",
                    "assignee",
                    "source",
                    "sourceId",
                    "sourceCreatedAt",
                    "sourceUpdatedAt",
                    "business",
                    "sourceProject",
                    "participants",
                    "creator",
                    "link",
                    "due",
                    "completedAt",
                ],
                20000,
            )
        {
            return Err(fail("任务字段类型或长度无效"));
        }
        if !projects.contains(text(t, "projectId")) || text(t, "title").trim().is_empty() {
            return Err(fail("任务缺少项目或标题"));
        }
        if !["待处理", "开发中", "修复中", "已解决", "已完成", "已取消"]
            .contains(&text(t, "status"))
            || !["非常紧急", "紧急", "普通", "较低"].contains(&text(t, "priority"))
        {
            return Err(fail("任务状态或优先级无效"));
        }
        for key in ["due", "completedAt"] {
            if !text(t, key).is_empty() && !valid_date(text(t, key)) {
                return Err(fail("任务日期无效"));
            }
        }
        if !url(text(t, "link")) {
            return Err(fail("任务链接无效"));
        }
        let pair = (text(t, "source"), text(t, "sourceId"));
        if !pair.0.is_empty() && !pair.1.is_empty() && !source_ids.insert(pair) {
            return Err(fail("来源任务 ID 重复"));
        }
    }
    for r in array(v, "records")? {
        if !strings(
            r,
            &[
                "text",
                "stage",
                "background",
                "role",
                "solution",
                "challenge",
                "result",
                "evidence",
                "tags",
            ],
            20000,
        ) || !tasks.contains(text(r, "taskId"))
            || !valid_date(text(r, "date"))
            || text(r, "text").trim().is_empty()
            || !url(text(r, "evidence"))
        {
            return Err(fail("工作记录或关联任务无效"));
        }
    }
    for r in array(v, "reports")? {
        if r.get("title").and_then(Value::as_str).is_none()
            || !strings(r, &["title", "reporter", "group", "url"], 20000)
        {
            return Err(fail("周报字段无效"));
        }
        if !valid_date(text(r, "start"))
            || !valid_date(text(r, "end"))
            || text(r, "start") > text(r, "end")
            || !url(text(r, "url"))
        {
            return Err(fail("周报日期或链接无效"));
        }
        let mut row_ids = HashSet::new();
        for row in array(r, "rows")? {
            if !strings(row, &["id", "details", "stage", "owners", "remarks"], 20000)
                || text(row, "id").is_empty()
                || !row_ids.insert(text(row, "id"))
                || !["本周完成事项及存在问题", "下周工作计划"].contains(&text(row, "section"))
            {
                return Err(fail("周报事项格式无效"));
            }
            for id in array(row, "taskIds")? {
                if !id.as_str().is_some_and(|id| tasks.contains(id)) {
                    return Err(fail("周报引用了不存在的任务"));
                }
            }
        }
    }
    for b in array(v, "imports")? {
        if !strings(b, &["at"], 20000)
            || text(b, "at").len() < 10
            || chrono::DateTime::parse_from_rfc3339(text(b, "at")).is_err()
        {
            return Err(fail("导入时间无效"));
        }
        for c in array(b, "changes")? {
            if text(c, "id").is_empty() || text(&c["after"], "id") != text(c, "id") {
                return Err(fail("导入变化记录无效"));
            }
        }
        array(b, "newProjects")?;
    }
    Ok(())
}
impl Database {
    pub fn open(path: impl AsRef<Path>) -> Result<Self> {
        let path = path.as_ref().to_path_buf();
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        let conn = Connection::open(&path)?;
        conn.busy_timeout(Duration::from_secs(5))?;
        conn.pragma_update(None, "foreign_keys", "ON")?;
        let version: i64 = conn.pragma_query_value(None, "user_version", |r| r.get(0))?;
        if version > SCHEMA {
            return Err(fail("数据库由更新版本创建，请升级客户端"));
        }
        if version == 0 {
            let tables:i64=conn.query_row("SELECT count(*) FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",[],|r|r.get(0))?;
            if tables > 0 {
                return Err(fail("文件不是拾序数据库，未修改原文件"));
            }
            conn.execute_batch("BEGIN IMMEDIATE;")?;
            if let Err(e) = conn.execute_batch(SQL) {
                let _ = conn.execute_batch("ROLLBACK;");
                return Err(e.into());
            }
            conn.execute_batch("COMMIT;")?;
        }
        conn.pragma_update(None, "journal_mode", "WAL")?;
        conn.pragma_update(None, "synchronous", "FULL")?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&path, fs::Permissions::from_mode(0o600))?;
        }
        Ok(Self { conn, path })
    }
    pub fn path(&self) -> &Path {
        &self.path
    }
    pub fn load(&self) -> Result<Snapshot> {
        // One read transaction prevents mixed snapshots if another process writes.
        self.conn.execute_batch("BEGIN DEFERRED;")?;
        let result = (|| {
            let revision: i64 =
                self.conn
                    .query_row("SELECT revision FROM meta WHERE singleton=1", [], |r| {
                        r.get(0)
                    })?;
            let mut workspace = json!({"version":2});
            for table in ["projects", "tasks", "records", "reports", "imports"] {
                let mut stmt = self
                    .conn
                    .prepare(&format!("SELECT payload FROM {table} ORDER BY position"))?;
                let jsons = stmt
                    .query_map([], |r| r.get::<_, String>(0))?
                    .collect::<std::result::Result<Vec<_>, _>>()?;
                let rows = jsons
                    .iter()
                    .map(|s| serde_json::from_str(s))
                    .collect::<std::result::Result<Vec<Value>, _>>()?;
                workspace[table] = Value::Array(rows);
            }
            validate(&workspace)?;
            Ok(Snapshot {
                workspace,
                revision,
            })
        })();
        match result {
            Ok(value) => {
                self.conn.execute_batch("COMMIT;")?;
                Ok(value)
            }
            Err(e) => {
                let _ = self.conn.execute_batch("ROLLBACK;");
                Err(e)
            }
        }
    }
    pub fn save(&mut self, workspace: &Value, expected: i64) -> Result<i64> {
        validate(workspace)?;
        let tx = self
            .conn
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let actual: i64 = tx.query_row("SELECT revision FROM meta WHERE singleton=1", [], |r| {
            r.get(0)
        })?;
        if actual != expected {
            return Err(Error::Conflict);
        }
        // Replace a validated snapshot in one transaction. Indexed columns and
        // foreign keys remain queryable; payloads preserve extensible UI fields.
        tx.execute_batch("DELETE FROM report_tasks; DELETE FROM records; DELETE FROM reports; DELETE FROM tasks; DELETE FROM projects; DELETE FROM imports;")?;
        for (i, p) in array(workspace, "projects")?.iter().enumerate() {
            tx.execute(
                "INSERT INTO projects VALUES(?1,?2,?3,?4)",
                params![text(p, "id"), i as i64, text(p, "name"), p.to_string()],
            )?;
        }
        for (i, t) in array(workspace, "tasks")?.iter().enumerate() {
            tx.execute(
                "INSERT INTO tasks VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9)",
                params![
                    text(t, "id"),
                    i as i64,
                    text(t, "projectId"),
                    text(t, "source"),
                    text(t, "sourceId"),
                    text(t, "status"),
                    text(t, "priority"),
                    text(t, "completedAt"),
                    t.to_string()
                ],
            )?;
        }
        for (i, r) in array(workspace, "records")?.iter().enumerate() {
            tx.execute(
                "INSERT INTO records VALUES(?1,?2,?3,?4,?5,?6)",
                params![
                    text(r, "id"),
                    i as i64,
                    text(r, "taskId"),
                    text(r, "date"),
                    r.get("career").and_then(Value::as_bool).unwrap_or(false),
                    r.to_string()
                ],
            )?;
        }
        for (i, r) in array(workspace, "reports")?.iter().enumerate() {
            tx.execute(
                "INSERT INTO reports VALUES(?1,?2,?3,?4,?5)",
                params![
                    text(r, "id"),
                    i as i64,
                    text(r, "start"),
                    text(r, "end"),
                    r.to_string()
                ],
            )?;
            for row in array(r, "rows")? {
                for task in array(row, "taskIds")? {
                    tx.execute(
                        "INSERT OR IGNORE INTO report_tasks VALUES(?1,?2,?3)",
                        params![text(r, "id"), text(row, "id"), task.as_str().unwrap()],
                    )?;
                }
            }
        }
        for (i, b) in array(workspace, "imports")?.iter().enumerate() {
            tx.execute(
                "INSERT INTO imports VALUES(?1,?2,?3)",
                params![text(b, "id"), i as i64, b.to_string()],
            )?;
        }
        let revision = actual
            .checked_add(1)
            .ok_or_else(|| fail("数据库版本号溢出"))?;
        tx.execute("UPDATE meta SET revision=?1 WHERE singleton=1", [revision])?;
        tx.commit()?;
        Ok(revision)
    }
    /// SQLite's backup API includes committed WAL contents; copying a live .sqlite
    /// file alone is not a safe backup strategy.
    pub fn backup(&self, destination: &Path) -> Result<()> {
        if destination == self.path {
            return Err(fail("不能覆盖当前正在使用的数据库"));
        }
        if destination.exists() {
            return Err(fail("目标文件已存在，请选择新的备份文件名"));
        }
        let file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(destination)?;
        drop(file);
        let result = (|| {
            self.conn.backup("main", destination, None)?;
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                fs::set_permissions(destination, fs::Permissions::from_mode(0o600))?;
            }
            Ok(())
        })();
        if result.is_err() {
            let _ = fs::remove_file(destination);
        }
        result
    }
    pub fn restore(&mut self, source: &Path, expected: i64, backup_dir: &Path) -> Result<i64> {
        // Read-only open: a selected arbitrary file is never migrated or modified.
        let incoming = Connection::open_with_flags(source, OpenFlags::SQLITE_OPEN_READ_ONLY)?;
        incoming.busy_timeout(Duration::from_secs(5))?;
        let version: i64 = incoming.pragma_query_value(None, "user_version", |r| r.get(0))?;
        if version != SCHEMA {
            return Err(fail("备份数据库版本不受支持"));
        }
        let check: String = incoming.query_row("PRAGMA integrity_check", [], |r| r.get(0))?;
        if check != "ok" {
            return Err(fail("备份数据库完整性检查失败"));
        }
        let src = Self {
            conn: incoming,
            path: source.into(),
        };
        let snapshot = src.load()?;
        // Check before backing up; save checks again inside its write transaction.
        if self.load()?.revision != expected {
            return Err(Error::Conflict);
        }
        self.automatic_backup(backup_dir, "before-restore")?;
        self.save(&snapshot.workspace, expected)
    }
    pub fn automatic_backup(&self, dir: &Path, prefix: &str) -> Result<PathBuf> {
        fs::create_dir_all(dir)?;
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|_| fail("系统时钟无效"))?
            .as_nanos();
        let dest = dir.join(format!("{prefix}-{nanos}.sqlite"));
        self.backup(&dest)?;
        Ok(dest)
    }
    pub fn backup_if_new_day(&self, dir: &Path) -> Result<()> {
        // Beijing day bucket; snapshots before restore are always separate.
        let day = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|_| fail("系统时钟无效"))?
            .as_secs()
            .saturating_add(8 * 3600)
            / 86400;
        fs::create_dir_all(dir)?;
        let dest = dir.join(format!("daily-{day}.sqlite"));
        if !dest.exists() {
            self.backup(&dest)?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn sample() -> Value {
        json!({"version":2,"projects":[{"id":"p","name":"项目","description":"说明"}],"tasks":[{"id":"t","projectId":"p","title":"原始任务","source":"我的任务","sourceId":"HJOK-257","status":"开发中","priority":"紧急","completedAt":"","module":"车辆分级"}],"records":[{"id":"r","taskId":"t","date":"2026-11-10","text":"排查并修复，待验证","career":true,"role":"后端排查"}],"reports":[{"id":"week","title":"一周快照","start":"2026-11-09","end":"2026-11-15","rows":[{"id":"line","taskIds":["t"],"section":"本周完成事项及存在问题","details":"当时的进展","stage":"待验证"}]}],"imports":[{"id":"batch","at":"2026-11-10T08:00:00Z","changes":[],"newProjects":[]}]})
    }
    #[test]
    fn round_trip_restart_and_sql_indexes() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("shixu.sqlite");
        {
            let mut db = Database::open(&path).unwrap();
            assert_eq!(db.load().unwrap().revision, 0);
            let data = sample();
            assert_eq!(db.save(&data, 0).unwrap(), 1);
            assert_eq!(db.load().unwrap().workspace, data);
            let count: i64 = db
                .conn
                .query_row(
                    "SELECT count(*) FROM records WHERE career=1 AND task_id='t'",
                    [],
                    |r| r.get(0),
                )
                .unwrap();
            assert_eq!(count, 1);
        }
        let db = Database::open(&path).unwrap();
        assert_eq!(db.load().unwrap().workspace, sample());
        assert_eq!(db.load().unwrap().revision, 1);
    }
    #[test]
    fn stale_writes_and_invalid_references_do_not_change_data() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("s.sqlite");
        let mut a = Database::open(&path).unwrap();
        let mut b = Database::open(&path).unwrap();
        a.save(&sample(), 0).unwrap();
        assert!(matches!(b.save(&sample(), 0), Err(Error::Conflict)));
        let mut invalid = sample();
        invalid["records"][0]["taskId"] = json!("missing");
        assert!(a.save(&invalid, 1).is_err());
        assert_eq!(a.load().unwrap().workspace, sample());
        let mut duplicate = sample();
        let copy = duplicate["tasks"][0].clone();
        duplicate["tasks"].as_array_mut().unwrap().push(copy);
        assert!(a.save(&duplicate, 1).is_err());
    }
    #[test]
    fn database_error_rolls_back_deletes_and_inserts() {
        let dir = tempfile::tempdir().unwrap();
        let mut db = Database::open(dir.path().join("s.sqlite")).unwrap();
        db.save(&sample(), 0).unwrap();
        db.conn.execute_batch("CREATE TRIGGER stop_write BEFORE INSERT ON records BEGIN SELECT RAISE(ABORT,'simulated disk/write failure'); END;").unwrap();
        let mut next = sample();
        next["tasks"][0]["title"] = json!("new");
        assert!(db.save(&next, 1).is_err());
        assert_eq!(db.load().unwrap().workspace, sample());
        assert_eq!(db.load().unwrap().revision, 1);
    }
    #[test]
    fn live_backup_includes_wal_and_restore_keeps_pre_restore_snapshot() {
        let dir = tempfile::tempdir().unwrap();
        let mut db = Database::open(dir.path().join("s.sqlite")).unwrap();
        let backup = dir.path().join("export.sqlite");
        let safety = dir.path().join("backups");
        db.save(&sample(), 0).unwrap();
        db.backup(&backup).unwrap();
        assert!(db.backup(&backup).is_err());
        assert!(db.backup(db.path()).is_err());
        let mut edited = sample();
        edited["tasks"][0]["title"] = json!("new title");
        db.save(&edited, 1).unwrap();
        let revision = db.restore(&backup, 2, &safety).unwrap();
        assert_eq!(revision, 3);
        assert_eq!(db.load().unwrap().workspace, sample());
        let before = fs::read_dir(&safety)
            .unwrap()
            .next()
            .unwrap()
            .unwrap()
            .path();
        assert_eq!(
            Database::open(before).unwrap().load().unwrap().workspace,
            edited
        );
    }
    #[test]
    fn reject_foreign_or_future_database_without_modifying_original() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("foreign.sqlite");
        let conn = Connection::open(&path).unwrap();
        conn.execute_batch(
            "CREATE TABLE private_notes(note TEXT);INSERT INTO private_notes VALUES('keep');",
        )
        .unwrap();
        drop(conn);
        assert!(Database::open(&path).is_err());
        let conn = Connection::open(&path).unwrap();
        let text: String = conn
            .query_row("SELECT note FROM private_notes", [], |r| r.get(0))
            .unwrap();
        assert_eq!(text, "keep");
        drop(conn);
        let future = dir.path().join("future.sqlite");
        let conn = Connection::open(&future).unwrap();
        conn.pragma_update(None, "user_version", 99).unwrap();
        drop(conn);
        assert!(Database::open(&future).is_err());
    }
    #[test]
    fn invalid_restore_keeps_current_database_and_selected_file_untouched() {
        let dir = tempfile::tempdir().unwrap();
        let mut db = Database::open(dir.path().join("s.sqlite")).unwrap();
        db.save(&sample(), 0).unwrap();
        let invalid = dir.path().join("broken.sqlite");
        fs::write(&invalid, b"not a database").unwrap();
        assert!(db
            .restore(&invalid, 1, &dir.path().join("backups"))
            .is_err());
        assert_eq!(fs::read(&invalid).unwrap(), b"not a database");
        assert_eq!(db.load().unwrap().workspace, sample());
    }
    #[test]
    fn daily_backups_are_created_once_per_day() {
        let dir = tempfile::tempdir().unwrap();
        let db = Database::open(dir.path().join("s.sqlite")).unwrap();
        let backups = dir.path().join("backups");
        db.backup_if_new_day(&backups).unwrap();
        db.backup_if_new_day(&backups).unwrap();
        assert_eq!(fs::read_dir(backups).unwrap().count(), 1);
    }
}

#[cfg(test)]
mod input_tests {
    use super::*;
    #[test]
    fn invalid_unicode_import_time_is_rejected_without_panicking() {
        let value = json!({"version":2,"projects":[],"tasks":[],"records":[],"reports":[],"imports":[{"id":"x","at":"中文🙂🙂日期","changes":[],"newProjects":[]}]});
        assert!(validate(&value).is_err());
    }
}
