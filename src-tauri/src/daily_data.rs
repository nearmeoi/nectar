use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter};
use serde::{Deserialize, Serialize};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

static RUNNING_CHILD: Mutex<Option<Child>> = Mutex::new(None);
static IS_RUNNING: AtomicBool = AtomicBool::new(false);

const DEFAULT_PROJECT_ROOT: &str = r"C:\Users\Akmal\Akmal";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FolderInfo {
    pub name: String,
    pub path: String,
    pub is_today: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StageEvent {
    pub stage: u32,
    pub name: String,
    pub status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LogEvent {
    pub raw: String,
    pub humanized: String,
    pub stage: u32,
    pub is_error: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FinishEvent {
    pub success: bool,
    pub message: String,
    pub duration_sec: f64,
}

/// Helper untuk mengubah log teknis menjadi bahasa manusia yang ringkas dan ramah.
fn humanize_log(line: &str) -> (String, u32, bool) {
    let lower = line.to_lowercase();
    let is_err = lower.contains("error") || lower.contains("gagal") || lower.contains("permission denied");

    let stage;
    if lower.contains("tahap [1/9]") || lower.contains("deteksi & validasi") {
        return ("Memeriksa kelengkapan file input...".to_string(), 1, false);
    }
    if lower.contains("tahap [2/9]") || lower.contains("agregasi & pivot stok") {
        return ("Mengagregasi stok fisik Makassar (WH 56)...".to_string(), 2, false);
    }
    if lower.contains("tahap [3/9]") || lower.contains("filter 2026 murni") {
        return ("Menyaring data barang in-transit (TRN)...".to_string(), 3, false);
    }
    if lower.contains("tahap [4/9]") || lower.contains("pivot soout") {
        return ("Menyinkronkan stok & batch FIFO SOOUT...".to_string(), 4, false);
    }
    if lower.contains("tahap [5/9]") || lower.contains("pivot poout") {
        return ("Menghitung sisa pesanan pengadaan (POOUT)...".to_string(), 5, false);
    }
    if lower.contains("tahap [6/9]") || lower.contains("pengisian nilai format cabang") {
        return ("Mengisi 22.417 baris master Format Cabang...".to_string(), 6, false);
    }
    if lower.contains("tahap [7/9]") || lower.contains("alokasi buku masuk") {
        return ("Memproses alokasi Buku Masuk FIFO...".to_string(), 7, false);
    }
    if lower.contains("tahap [8/9]") || lower.contains("do summary") {
        return ("Menyusun rekapitulasi DO Summary External...".to_string(), 8, false);
    }
    if lower.contains("tahap [9/9]") || lower.contains("recheck sp kemarin") {
        return ("Memvalidasi posting SP kemarin & cek selisih...".to_string(), 9, false);
    }

    stage = 0;

    if is_err {
        if lower.contains("sedang dibuka") || lower.contains("filelockerror") || lower.contains("permission denied") {
            return ("File Excel sedang terbuka di komputer. Harap tutup terlebih dahulu.".to_string(), stage, true);
        }
        return (format!("Kendala: {}", line.trim()), stage, true);
    }

    if lower.contains("file print selesai") {
        return ("File BUKMAS PRINT selesai dibuat.".to_string(), 7, false);
    }
    if lower.contains("sheet delimit disusun") {
        return ("Batch delimit 14 item selesai disusun.".to_string(), 4, false);
    }
    if lower.contains("file format cabang berhasil disimpan") {
        return ("Format Cabang berhasil diperbarui.".to_string(), 6, false);
    }
    if lower.contains("file laporan recheck tersimpan") {
        return ("Laporan Recheck SP selesai dibuat.".to_string(), 9, false);
    }
    if lower.contains("seluruh tahapan pipeline yang dipilih berhasil") || lower.contains("hasil: 8 berhasil") {
        return ("Seluruh tahapan pipeline selesai dengan sukses.".to_string(), stage, false);
    }

    let clean = line.trim()
        .trim_start_matches(|c: char| c == '[' || c == ']' || c == '=' || c == '-' || c == ' ')
        .to_string();
    (clean, stage, false)
}

#[tauri::command]
pub async fn get_daily_data_folders() -> Result<Vec<FolderInfo>, String> {
    let root = PathBuf::from(DEFAULT_PROJECT_ROOT);
    if !root.exists() {
        return Ok(vec![]);
    }

    let read_dir = std::fs::read_dir(&root)
        .map_err(|e| format!("Gagal membaca direktori {}: {e}", root.display()))?;

    let mut folders = Vec::new();
    let today_str = chrono::Local::now().format("%d %b %Y").to_string().to_uppercase();

    for entry in read_dir.flatten() {
        if let Ok(file_type) = entry.file_type() {
            if file_type.is_dir() {
                let name = entry.file_name().to_string_lossy().to_string();
                let is_date_pattern = name.len() >= 10 && name.chars().take(2).all(|c| c.is_ascii_digit());
                if is_date_pattern {
                    let is_today = name.to_uppercase().contains(&today_str);
                    folders.push(FolderInfo {
                        name: name.clone(),
                        path: entry.path().to_string_lossy().to_string(),
                        is_today,
                    });
                }
            }
        }
    }

    folders.sort_by(|a, b| b.name.cmp(&a.name));
    Ok(folders)
}

#[tauri::command]
pub async fn open_daily_data_folder(path: Option<String>) -> Result<(), String> {
    let target = path.unwrap_or_else(|| DEFAULT_PROJECT_ROOT.to_string());
    tauri_plugin_opener::open_path(&target, None::<&str>).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn is_daily_data_running() -> Result<bool, String> {
    Ok(IS_RUNNING.load(Ordering::Relaxed))
}

#[tauri::command]
pub async fn stop_daily_data() -> Result<(), String> {
    if let Ok(mut lock) = RUNNING_CHILD.lock() {
        if let Some(mut child) = lock.take() {
            let _ = child.kill();
        }
    }
    IS_RUNNING.store(false, Ordering::Relaxed);
    Ok(())
}

#[tauri::command]
pub async fn run_daily_data(
    app: AppHandle,
    folder: Option<String>,
    stages: Option<Vec<u32>>,
) -> Result<FinishEvent, String> {
    if IS_RUNNING.swap(true, Ordering::SeqCst) {
        return Err("Pipeline sedang berjalan.".to_string());
    }

    let python_exe = PathBuf::from(DEFAULT_PROJECT_ROOT)
        .join("App")
        .join(".venv")
        .join("Scripts")
        .join("python.exe");

    let main_py = PathBuf::from(DEFAULT_PROJECT_ROOT)
        .join("App")
        .join("main.py");

    if !python_exe.exists() {
        IS_RUNNING.store(false, Ordering::Relaxed);
        return Err(format!("Python virtual environment tidak ditemukan: {}", python_exe.display()));
    }
    if !main_py.exists() {
        IS_RUNNING.store(false, Ordering::Relaxed);
        return Err(format!("File main.py tidak ditemukan: {}", main_py.display()));
    }

    let mut cmd = Command::new(&python_exe);
    cmd.arg(&main_py);

    if let Some(f) = &folder {
        if !f.trim().is_empty() {
            cmd.arg(f);
        }
    }

    if let Some(s_list) = &stages {
        if !s_list.is_empty() {
            let stages_str = s_list.iter().map(|n| n.to_string()).collect::<Vec<_>>().join(",");
            cmd.arg("--stages").arg(stages_str);
        }
    }

    cmd.current_dir(DEFAULT_PROJECT_ROOT);
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());

    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);

    let start_time = std::time::Instant::now();

    let mut child = cmd.spawn().map_err(|e| {
        IS_RUNNING.store(false, Ordering::Relaxed);
        format!("Gagal menjalankan proses Python: {e}")
    })?;

    let stdout = child.stdout.take().ok_or("Gagal membuka stdout")?;
    let stderr = child.stderr.take().ok_or("Gagal membuka stderr")?;

    if let Ok(mut lock) = RUNNING_CHILD.lock() {
        *lock = Some(child);
    }

    let app_handle_out = app.clone();
    std::thread::spawn(move || {
        let reader = BufReader::new(stdout);
        for line in reader.lines().map_while(Result::ok) {
            let (humanized, stage, is_err) = humanize_log(&line);
            if !humanized.is_empty() {
                let _ = app_handle_out.emit(
                    "daily-data-log",
                    LogEvent {
                        raw: line.clone(),
                        humanized: humanized.clone(),
                        stage,
                        is_error: is_err,
                    },
                );

                if stage > 0 {
                    let _ = app_handle_out.emit(
                        "daily-data-stage",
                        StageEvent {
                            stage,
                            name: humanized,
                            status: if is_err { "failed".to_string() } else { "running".to_string() },
                        },
                    );
                }
            }
        }
    });

    let app_handle_err = app.clone();
    std::thread::spawn(move || {
        let reader = BufReader::new(stderr);
        for line in reader.lines().map_while(Result::ok) {
            let trimmed = line.trim();
            if !trimmed.is_empty() {
                let (humanized, stage, _) = humanize_log(trimmed);
                let _ = app_handle_err.emit(
                    "daily-data-log",
                    LogEvent {
                        raw: line,
                        humanized,
                        stage,
                        is_error: true,
                    },
                );
            }
        }
    });

    // Wait on a background thread in tokio task
    let wait_res = tokio::task::spawn_blocking(move || {
        let mut child_to_wait = None;
        if let Ok(mut lock) = RUNNING_CHILD.lock() {
            child_to_wait = lock.take();
        }
        let status = if let Some(mut c) = child_to_wait {
            c.wait()
        } else {
            Err(std::io::Error::new(std::io::ErrorKind::Other, "Proses telah dihentikan"))
        };
        IS_RUNNING.store(false, Ordering::Relaxed);
        status
    }).await.map_err(|e| format!("Task join error: {e}"))?;

    let duration_sec = start_time.elapsed().as_secs_f64();

    match wait_res {
        Ok(status) => {
            let success = status.success();
            let msg = if success {
                format!("Selesai dalam {:.1} detik", duration_sec)
            } else {
                "Proses terhenti atau terjadi kendala".to_string()
            };
            let finish_ev = FinishEvent {
                success,
                message: msg,
                duration_sec,
            };
            let _ = app.emit("daily-data-finish", finish_ev.clone());
            Ok(finish_ev)
        }
        Err(e) => {
            let finish_ev = FinishEvent {
                success: false,
                message: format!("Error: {e}"),
                duration_sec,
            };
            let _ = app.emit("daily-data-finish", finish_ev.clone());
            Err(format!("Proses gagal: {e}"))
        }
    }
}
