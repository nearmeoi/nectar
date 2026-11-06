use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use chrono::{Datelike, Local};
use reqwest::header::{HeaderMap, HeaderValue, ACCEPT, CONTENT_TYPE, COOKIE, ORIGIN, REFERER, USER_AGENT};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

#[allow(dead_code)]
pub const DEFAULT_COOKIES: &str = "";
pub const DEFAULT_WH: &str = "56|56";
const URL: &str = "https://apps.erlangga.id/yesss/info_do_summary/get_data.html";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ErlanggaItem {
    pub no: i64,
    pub do_number: String,
    pub tgl_do: String,
    pub po: String,
    pub item_code: String,
    pub item_name: String,
    pub qty: i64,
    pub sisa: i64,
    pub rp: String,
    pub status: String,
    pub modified_by: String,
    pub pelanggan: String,
    pub guru: String,
    pub sales: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ErlanggaSummary {
    pub title: String,
    pub total_qty: i64,
    pub total_sisa: i64,
    pub total_rp: String,
    pub total_items: usize,
    pub close_count: usize,
    pub on_order_count: usize,
    pub last_updated: u64,
    pub items: Vec<ErlanggaItem>,
    pub error: Option<String>,
}

fn cache_path(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_config_dir().ok().map(|d| d.join("erlangga_cache.json"))
}

pub fn load_cached(app: &AppHandle) -> Option<ErlanggaSummary> {
    let path = cache_path(app)?;
    let content = fs::read_to_string(path).ok()?;
    serde_json::from_str(&content).ok()
}

pub fn save_cache(app: &AppHandle, summary: &ErlanggaSummary) {
    if let Some(path) = cache_path(app) {
        if let Some(parent) = path.parent() {
            let _ = fs::create_dir_all(parent);
        }
        if let Ok(json) = serde_json::to_string(summary) {
            let _ = fs::write(path, json);
        }
    }
}


pub async fn ensure_yesss_cookies(sso_session: &str) -> Option<String> {
    crate::diagnostics::log("Exchanging sso_session for yesss extauth token...");
    let chrome_ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
    let client = reqwest::Client::builder()
        .user_agent(chrome_ua)
        .build()
        .ok()?;

    let res = client
        .get("https://apps.erlangga.id/sso/dashboard")
        .header(COOKIE, format!("sso_session={sso_session}"))
        .header(REFERER, "https://apps.erlangga.id/sso/login")
        .send()
        .await
        .ok()?;

    let html = res.text().await.ok()?;
    let yesss_pos = html.find("frmAppyesss")?;
    let slice = &html[yesss_pos..std::cmp::min(yesss_pos + 1200, html.len())];

    let needle_user = r#"name="username" value=""#;
    let user_start = slice.find(needle_user)? + needle_user.len();
    let user_end = slice[user_start..].find('"')? + user_start;
    let username = &slice[user_start..user_end];

    let needle_token = r#"name="token" value=""#;
    let token_start = slice.find(needle_token)? + needle_token.len();
    let token_end = slice[token_start..].find('"')? + token_start;
    let token = &slice[token_start..token_end];

    crate::diagnostics::log(&format!("Found yesss auth token for user {}", username));

    let client_no_redirect = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .user_agent(chrome_ua)
        .build()
        .ok()?;

    let extauth_res = client_no_redirect
        .post("https://apps.erlangga.id/yesss/extauth")
        .header(COOKIE, format!("sso_session={sso_session}"))
        .header(ORIGIN, "https://apps.erlangga.id")
        .header(REFERER, "https://apps.erlangga.id/sso/dashboard")
        .form(&[("username", username), ("token", token)])
        .send()
        .await
        .ok()?;

    for (k, v) in extauth_res.headers() {
        if k == reqwest::header::SET_COOKIE {
            if let Ok(s) = v.to_str() {
                if s.contains("PHPSESSID=") {
                    for p in s.split(';') {
                        let trimmed = p.trim();
                        if trimmed.starts_with("PHPSESSID=") {
                            let combined = format!("sso_session={sso_session}; {trimmed}");
                            crate::diagnostics::log("Auto-exchanged PHPSESSID successfully!");
                            return Some(combined);
                        }
                    }
                }
            }
        }
    }
    None
}

pub async fn fetch_summary(
    app: &AppHandle,
    cookies_override: Option<String>,
    wh_override: Option<String>,
) -> Result<ErlanggaSummary, String> {
    let mut cookies = cookies_override
        .or_else(|| crate::utils::get_setting_str(app, "nectar-erlangga-cookies"))
        .unwrap_or_default();

    // If cookies only have sso_session without PHPSESSID, auto-exchange now!
    if !cookies.contains("PHPSESSID=") && cookies.contains("sso_session=") {
        let sso_val = cookies.split(';')
            .find(|p| p.trim().starts_with("sso_session="))
            .map(|p| p.trim().trim_start_matches("sso_session="))
            .unwrap_or("");
        if let Some(new_cookies) = ensure_yesss_cookies(sso_val).await {
            cookies = new_cookies.clone();
            let _ = crate::commands::save_setting(app.clone(), "nectar-erlangga-cookies".to_string(), serde_json::Value::String(new_cookies));
        }
    }

    if cookies.trim().is_empty() {
        return Err("Belum login. Silakan klik tombol Login untuk menghubungkan akun Erlangga.".to_string());
    }

    let wh = wh_override
        .or_else(|| crate::utils::get_setting_str(app, "nectar-erlangga-wh"))
        .unwrap_or_else(|| DEFAULT_WH.to_string());

    let now = Local::now();
    let (year, month, day) = if let Some(custom_date) = crate::utils::get_setting_str(app, "nectar-erlangga-date") {
        let parts: Vec<&str> = custom_date.split('-').collect();
        if parts.len() == 3 {
            (
                parts[0].to_string(),
                parts[1].trim_start_matches('0').to_string(),
                parts[2].trim_start_matches('0').to_string(),
            )
        } else {
            (now.year().to_string(), now.month().to_string(), now.day().to_string())
        }
    } else {
        (now.year().to_string(), now.month().to_string(), now.day().to_string())
    };

    let mut headers = HeaderMap::new();
    headers.insert(ACCEPT, HeaderValue::from_static("text/html, */*; q=0.01"));
    headers.insert(
        CONTENT_TYPE,
        HeaderValue::from_static("application/x-www-form-urlencoded; charset=UTF-8"),
    );
    headers.insert(ORIGIN, HeaderValue::from_static("https://apps.erlangga.id"));
    headers.insert(
        REFERER,
        HeaderValue::from_static("https://apps.erlangga.id/yesss/info_do_summary.html"),
    );
    headers.insert(
        USER_AGENT,
        HeaderValue::from_static(
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
        ),
    );
    headers.insert(
        "x-requested-with",
        HeaderValue::from_static("XMLHttpRequest"),
    );

    if let Ok(cookie_val) = HeaderValue::from_str(&cookies) {
        headers.insert(COOKIE, cookie_val);
    }

    let form_params = [
        ("opsi", "1"),
        ("wh", &wh),
        ("status", "all"),
        ("tahun", &year),
        ("tgl1", &day),
        ("bulan1", &month),
        ("tgl2", &day),
        ("bulan2", &month),
    ];

    let client = reqwest::Client::builder()
        .default_headers(headers)
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {e}"))?;

    let res = client
        .post(URL)
        .form(&form_params)
        .send()
        .await
        .map_err(|e| format!("Request failed: {e}"))?;

    // Check header for refresh redirect to forbidden.html
    if let Some(refresh_val) = res.headers().get("refresh") {
        if let Ok(ref_str) = refresh_val.to_str() {
            if ref_str.contains("forbidden.html") {
                return Err("Sesi login Erlangga telah kadaluarsa (forbidden). Silakan perbarui cookie sso_session & PHPSESSID di Settings > Notch > Stock.".to_string());
            }
        }
    }

    let html = res
        .text()
        .await
        .map_err(|e| format!("Failed to read response text: {e}"))?;

    if html.trim().is_empty() {
        return Err("Respon server kosong (0 bytes). Sesi login kemungkinan telah berakhir atau tidak ada data. Silakan periksa cookie di Settings.".to_string());
    }

    if html.contains("exeption/forbidden.html") || html.contains("Sign In") {
        return Err("Sesi login Erlangga telah kadaluarsa. Silakan perbarui cookie sso_session & PHPSESSID di Settings > Notch > Stock.".to_string());
    }

    let summary = parse_html(&html)?;
    save_cache(app, &summary);
    Ok(summary)
}

fn parse_html(html: &str) -> Result<ErlanggaSummary, String> {
    // 1. Title
    let title = if let Some(start) = html.find(r#"class="table-header">"#) {
        let rem = &html[start + 21..];
        if let Some(end) = rem.find("</div>") {
            rem[..end].trim().to_string()
        } else {
            "Rekap DO External SUMMARY".to_string()
        }
    } else {
        "Rekap DO External SUMMARY".to_string()
    };

    // 2. Total Row
    // <tr class='active'>
    //   <th class='text-center' colspan='6'>TOTAL</th>
    //   <th class='text-right'>1,397</th>
    //   <th class='text-right'>30</th>
    //   <th class='text-right'>96,485,100</th>
    // </tr>
    let mut total_qty = 0i64;
    let mut total_sisa = 0i64;
    let mut total_rp = "0".to_string();

    if let Some(active_pos) = html.rfind("class='active'") {
        let chunk = &html[active_pos..];
        let th_tags: Vec<&str> = chunk
            .split("<th")
            .filter_map(|part| {
                let close = part.find('>')?;
                let end = part.find("</th>")?;
                Some(part[close + 1..end].trim())
            })
            .collect();

        if th_tags.len() >= 4 {
            total_qty = th_tags[1].replace(',', "").parse().unwrap_or(0);
            total_sisa = th_tags[2].replace(',', "").parse().unwrap_or(0);
            total_rp = th_tags[3].to_string();
        }
    }

    if total_rp == "0" {
        if let Some(total_pos) = html.rfind("TOTAL") {
            let chunk = &html[total_pos..std::cmp::min(total_pos + 400, html.len())];
            let th_tags: Vec<&str> = chunk
                .split("<th")
                .filter_map(|part| {
                    let close = part.find('>')?;
                    let end = part.find("</th>")?;
                    Some(part[close + 1..end].trim())
                })
                .collect();
            if th_tags.len() >= 3 {
                total_qty = th_tags[0].replace(',', "").parse().unwrap_or(total_qty);
                total_sisa = th_tags[1].replace(',', "").parse().unwrap_or(total_sisa);
                total_rp = th_tags[2].to_string();
            }
        }
    }

    // 3. Table Rows
    let mut items = Vec::new();
    let mut close_count = 0;
    let mut on_order_count = 0;

    for row in html.split("<tr>") {
        if !row.contains("<td") {
            continue;
        }

        let cells: Vec<String> = row
            .split("<td")
            .filter_map(|part| {
                let close = part.find('>')?;
                let end = part.find("</td>")?;
                let text = &part[close + 1..end];
                // Strip nested html tags like <span ...>
                let clean = text
                    .split('<')
                    .map(|sub| {
                        if let Some(gt) = sub.find('>') {
                            &sub[gt + 1..]
                        } else {
                            sub
                        }
                    })
                    .collect::<Vec<_>>()
                    .join("")
                    .trim()
                    .to_string();
                Some(clean)
            })
            .collect();

        if cells.len() >= 10 {
            let no: i64 = cells[0].parse().unwrap_or(0);
            let do_number = cells.get(1).cloned().unwrap_or_default();
            let tgl_do = cells.get(2).cloned().unwrap_or_default();
            let po = cells.get(3).cloned().unwrap_or_default();
            let item_code = cells.get(4).cloned().unwrap_or_default();
            let item_name = cells.get(5).cloned().unwrap_or_default();
            let qty: i64 = cells.get(6).map(|s| s.replace(',', "").parse().unwrap_or(0)).unwrap_or(0);
            let sisa: i64 = cells.get(7).map(|s| s.replace(',', "").parse().unwrap_or(0)).unwrap_or(0);
            let rp = cells.get(8).cloned().unwrap_or_default();
            let status = cells.get(9).cloned().unwrap_or_default();
            let modified_by = cells.get(10).cloned().unwrap_or_default();
            let pelanggan = cells.get(11).cloned().unwrap_or_default();
            let guru = cells.get(12).cloned().unwrap_or_default();
            let sales = cells.get(13).cloned().unwrap_or_default();

            if status.to_lowercase().contains("close") {
                close_count += 1;
            } else if status.to_lowercase().contains("order") {
                on_order_count += 1;
            }

            items.push(ErlanggaItem {
                no,
                do_number,
                tgl_do,
                po,
                item_code,
                item_name,
                qty,
                sisa,
                rp,
                status,
                modified_by,
                pelanggan,
                guru,
                sales,
            });
        }
    }

    let now_ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);

    let total_items = items.len();

    Ok(ErlanggaSummary {
        title,
        total_qty,
        total_sisa,
        total_rp,
        total_items,
        close_count,
        on_order_count,
        last_updated: now_ts,
        items,
        error: None,
    })
}

#[tauri::command]
pub async fn get_erlangga_summary(app: AppHandle) -> Result<ErlanggaSummary, String> {
    if let Some(cached) = load_cached(&app) {
        // If cache is less than 5 minutes old, return it
        let now_ts = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        if now_ts.saturating_sub(cached.last_updated) < 300 {
            return Ok(cached);
        }
    }

    fetch_summary(&app, None, None).await
}

#[tauri::command]
pub async fn refresh_erlangga_summary(
    app: AppHandle,
    cookies: Option<String>,
    wh: Option<String>,
) -> Result<ErlanggaSummary, String> {
    fetch_summary(&app, cookies, wh).await
}

#[tauri::command]
pub async fn export_erlangga_do(app: AppHandle) -> Result<String, String> {
    let mut cookies = crate::utils::get_setting_str(&app, "nectar-erlangga-cookies")
        .unwrap_or_default();

    // Auto-exchange sso_session for PHPSESSID if missing
    if !cookies.contains("PHPSESSID=") && cookies.contains("sso_session=") {
        let sso_val = cookies
            .split(';')
            .find(|p| p.trim().starts_with("sso_session="))
            .map(|p| p.trim().trim_start_matches("sso_session="))
            .unwrap_or("");
        if let Some(new_cookies) = ensure_yesss_cookies(sso_val).await {
            cookies = new_cookies.clone();
            let _ = crate::commands::save_setting(
                app.clone(),
                "nectar-erlangga-cookies".to_string(),
                serde_json::Value::String(new_cookies),
            );
        }
    }

    if cookies.trim().is_empty() {
        return Err("Belum login. Silakan klik tombol Login terlebih dahulu.".to_string());
    }

    let client = reqwest::Client::builder()
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {e}"))?;

    let wh = crate::utils::get_setting_str(&app, "nectar-erlangga-wh")
        .unwrap_or_else(|| DEFAULT_WH.to_string());

    let now = Local::now();
    let (year, month, day) = if let Some(custom_date) = crate::utils::get_setting_str(&app, "nectar-erlangga-date") {
        let parts: Vec<&str> = custom_date.split('-').collect();
        if parts.len() == 3 {
            (
                parts[0].to_string(),
                parts[1].trim_start_matches('0').to_string(),
                parts[2].trim_start_matches('0').to_string(),
            )
        } else {
            (now.year().to_string(), now.month().to_string(), now.day().to_string())
        }
    } else {
        (now.year().to_string(), now.month().to_string(), now.day().to_string())
    };

    let query_params = [
        ("wh", wh.as_str()),
        ("tahun", year.as_str()),
        ("bulan1", month.as_str()),
        ("tgl1", day.as_str()),
        ("bulan2", month.as_str()),
        ("tgl2", day.as_str()),
        ("status", "all"),
    ];

    let mut headers = HeaderMap::new();
    headers.insert(
        ACCEPT,
        HeaderValue::from_static("text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"),
    );
    headers.insert(ORIGIN, HeaderValue::from_static("https://apps.erlangga.id"));
    headers.insert(
        REFERER,
        HeaderValue::from_static("https://apps.erlangga.id/yesss/info_do_summary.html"),
    );
    headers.insert(
        USER_AGENT,
        HeaderValue::from_static(
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
        ),
    );

    if let Ok(cookie_val) = HeaderValue::from_str(&cookies) {
        headers.insert(COOKIE, cookie_val);
    }

    let res = client
        .get("https://apps.erlangga.id/yesss/info_do_summary/export_data")
        .query(&query_params)
        .headers(headers)
        .send()
        .await
        .map_err(|e| format!("Gagal menghubungi server Erlangga: {e}"))?;

    // Check header for refresh redirect to forbidden.html
    if let Some(refresh_val) = res.headers().get("refresh") {
        if let Ok(ref_str) = refresh_val.to_str() {
            if ref_str.contains("forbidden.html") {
                return Err("Sesi login Erlangga telah kadaluarsa (forbidden). Silakan klik tombol Login terlebih dahulu.".to_string());
            }
        }
    }

    // Capture renewed PHPSESSID if server sent one
    for (k, v) in res.headers() {
        if k == reqwest::header::SET_COOKIE {
            if let Ok(s) = v.to_str() {
                if s.contains("PHPSESSID=") {
                    for p in s.split(';') {
                        let trimmed = p.trim();
                        if trimmed.starts_with("PHPSESSID=") {
                            let sso_part = cookies
                                .split(';')
                                .find(|part| part.trim().starts_with("sso_session="))
                                .map(|p| p.trim().to_string());
                            if let Some(sso) = sso_part {
                                let combined = format!("{sso}; {trimmed}");
                                let _ = crate::commands::save_setting(
                                    app.clone(),
                                    "nectar-erlangga-cookies".to_string(),
                                    serde_json::Value::String(combined),
                                );
                            }
                        }
                    }
                }
            }
        }
    }

    let cd = res
        .headers()
        .get("content-disposition")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");

    let mut filename = if let Some(pos) = cd.find("filename=") {
        cd[pos + 9..]
            .trim()
            .trim_matches('"')
            .trim_matches('\'')
            .to_string()
    } else {
        format!("Do_Summary_External_{year}{month}{day}.csv")
    };

    if filename.is_empty() {
        filename = format!("Do_Summary_External_{year}{month}{day}.csv");
    }

    let bytes = res
        .bytes()
        .await
        .map_err(|e| format!("Gagal membaca data hasil export: {e}"))?;

    // Check if it's HTML error page
    if bytes.starts_with(b"<!DOCTYPE") || bytes.starts_with(b"<html") {
        let text = String::from_utf8_lossy(&bytes);
        if text.contains("forbidden") || text.contains("login") {
            return Err("Sesi kadaluarsa. Silakan klik tombol Login.".to_string());
        }
    }

    let target_dir = PathBuf::from(r"C:\Users\Akmal\Akmal\Do_Summary");
    fs::create_dir_all(&target_dir)
        .map_err(|e| format!("Gagal membuat direktori {}: {}", target_dir.display(), e))?;

    let mut dest_path = target_dir.join(&filename);
    // If writing fails (e.g., file opened in Excel), save with timestamp
    if let Err(e) = fs::write(&dest_path, &bytes) {
        let ts = Local::now().format("%H%M%S").to_string();
        let stem = dest_path
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("Do_Summary");
        let ext = dest_path
            .extension()
            .and_then(|s| s.to_str())
            .unwrap_or("csv");
        dest_path = target_dir.join(format!("{stem}_{ts}.{ext}"));
        fs::write(&dest_path, &bytes)
            .map_err(|e2| format!("Gagal menyimpan file ke {}: {e} / {e2}", dest_path.display()))?;
    }

    crate::diagnostics::log(&format!("DO Summary exported successfully to {}", dest_path.display()));
    Ok(dest_path.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn open_erlangga_login(app: AppHandle) -> Result<(), String> {
    if let Some(w) = app.get_webview_window("erlangga_login") {
        let _ = w.close();
    }

    // Start on about:blank so no previous cookies or stale sessions are sent to Erlangga
    let blank_url: tauri::Url = "about:blank".parse().map_err(|e| format!("{e}"))?;

    let init_js = r#"
        (() => {
            const autofill = () => {
                const u = document.getElementById('username') || document.querySelector('input[name="username"]');
                const p = document.getElementById('password-input') || document.querySelector('input[type="password"]');
                if (u && (!u.value || u.value !== 'r1385')) {
                    u.value = 'r1385';
                    u.dispatchEvent(new Event('input', { bubbles: true }));
                    u.dispatchEvent(new Event('change', { bubbles: true }));
                }
                if (p && (!p.value || p.value !== 'akmal123')) {
                    p.value = 'akmal123';
                    p.dispatchEvent(new Event('input', { bubbles: true }));
                    p.dispatchEvent(new Event('change', { bubbles: true }));
                }
            };

            const trySubmitYesss = () => {
                const href = window.location.href;
                if (href.includes('dashboard') || href.includes('/sso/home')) {
                    const frm = document.getElementById('frmAppyesss');
                    if (frm) {
                        console.log('Auto-submitting YESSS form...');
                        frm.submit();
                    }
                }
            };

            document.addEventListener('DOMContentLoaded', () => {
                autofill();
                trySubmitYesss();
            });

            window.addEventListener('load', () => {
                autofill();
                trySubmitYesss();
            });

            let count = 0;
            const interval = setInterval(() => {
                autofill();
                trySubmitYesss();
                count++;
                if (count > 25) clearInterval(interval);
            }, 250);
        })();
    "#;

    let window = WebviewWindowBuilder::new(&app, "erlangga_login", WebviewUrl::External(blank_url))
        .title("Login Erlangga SSO")
        .inner_size(520.0, 700.0)
        .resizable(true)
        .decorations(true)
        .center()
        .always_on_top(true)
        .focused(true)
        .initialization_script(init_js)
        .build()
        .map_err(|e| format!("Failed to create login window: {e}"))?;

    let app_handle = app.clone();
    let win_handle = window.clone();

    #[cfg(target_os = "windows")]
    {
        let _ = window.with_webview(move |webview| unsafe {
            use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2_2;
            use webview2_com::{GetCookiesCompletedHandler, NavigationCompletedEventHandler};
            use windows_core::Interface;

            let Ok(core) = webview.controller().CoreWebView2() else { return };
            let ah = app_handle.clone();
            let wh = win_handle.clone();

            // 1. CLEAR ALL COOKIES so user is completely logged out and sessions do not stack
            if let Ok(core2) = core.cast::<ICoreWebView2_2>() {
                if let Ok(cm) = core2.CookieManager() {
                    let _ = cm.DeleteAllCookies();
                    crate::diagnostics::log("Cleared all WebView2 cookies for completely fresh login");
                }
            }

            // 2. Clear saved cookie setting in Nectar
            let _ = crate::commands::save_setting(
                ah.clone(),
                "nectar-erlangga-cookies".to_string(),
                serde_json::Value::Null,
            );

            // 3. Navigate cleanly to the login page
            let login_url: Vec<u16> = "https://apps.erlangga.id/sso/login"
                .encode_utf16()
                .chain(std::iter::once(0))
                .collect();
            let _ = core.Navigate(windows_core::PCWSTR(login_url.as_ptr()));

            let mut nav_token = 0i64;
            let _ = core.add_NavigationCompleted(
                &NavigationCompletedEventHandler::create(Box::new(move |sender, _| {
                    let Some(core_webview) = sender else { return Ok(()) };
                    let mut uri_ptr = windows_core::PWSTR::null();
                    if core_webview.Source(&mut uri_ptr).is_ok() && !uri_ptr.is_null() {
                        let uri_str = uri_ptr.to_string().unwrap_or_default();
                        windows::Win32::System::Com::CoTaskMemFree(Some(uri_ptr.0 as *const _));

                        crate::diagnostics::log(&format!("WebView2 navigated to: {}", uri_str));

                        if uri_str.contains("/sso/login") || uri_str.contains("login") {
                            crate::diagnostics::log("Triggering autofill on login page");
                            let _ = wh.eval(r#"
                                (() => {
                                    const autofill = () => {
                                        const u = document.getElementById('username') || document.querySelector('input[name="username"]');
                                        const p = document.getElementById('password-input') || document.querySelector('input[type="password"]');
                                        if (u && (!u.value || u.value !== 'r1385')) {
                                            u.value = 'r1385';
                                            u.dispatchEvent(new Event('input', { bubbles: true }));
                                            u.dispatchEvent(new Event('change', { bubbles: true }));
                                        }
                                        if (p && (!p.value || p.value !== 'akmal123')) {
                                            p.value = 'akmal123';
                                            p.dispatchEvent(new Event('input', { bubbles: true }));
                                            p.dispatchEvent(new Event('change', { bubbles: true }));
                                        }
                                    };
                                    autofill();
                                    setTimeout(autofill, 200);
                                    setTimeout(autofill, 600);
                                    setTimeout(autofill, 1200);
                                    setTimeout(autofill, 2500);
                                })();
                            "#);
                        }

                        if uri_str.contains("dashboard") || uri_str.contains("/sso/home") {
                            let _ = wh.eval(r#"
                                (() => {
                                    const trySubmit = () => {
                                        const frm = document.getElementById('frmAppyesss');
                                        if (frm) {
                                            console.log('Auto-submitting frmAppyesss from NavigationCompleted...');
                                            frm.submit();
                                        }
                                    };
                                    trySubmit();
                                    setTimeout(trySubmit, 300);
                                    setTimeout(trySubmit, 800);
                                })();
                            "#);
                        }

                        if uri_str.contains("/sso/home") || uri_str.contains("/yesss/") || uri_str.contains("dashboard") {
                            if let Ok(core2) = core_webview.cast::<ICoreWebView2_2>() {
                                if let Ok(cm) = core2.CookieManager() {
                                    let domain_uri: Vec<u16> = "https://apps.erlangga.id".encode_utf16().chain(std::iter::once(0)).collect();
                                    let app_c = ah.clone();
                                    let win_c = wh.clone();

                                    let handler = GetCookiesCompletedHandler::create(Box::new(move |hr, cookie_list| {
                                        if hr.is_ok() {
                                            if let Some(list) = cookie_list {
                                                let mut count = 0u32;
                                                let _ = list.Count(&mut count);
                                                let mut sso = String::new();
                                                let mut php = String::new();

                                                for i in 0..count {
                                                    if let Ok(c) = list.GetValueAtIndex(i) {
                                                        let mut name_ptr = windows_core::PWSTR::null();
                                                        let mut val_ptr = windows_core::PWSTR::null();
                                                        if c.Name(&mut name_ptr).is_ok() && c.Value(&mut val_ptr).is_ok() {
                                                            let n = name_ptr.to_string().unwrap_or_default();
                                                            let v = val_ptr.to_string().unwrap_or_default();
                                                            if n == "sso_session" { sso = v; }
                                                            else if n == "PHPSESSID" { php = v; }
                                                            windows::Win32::System::Com::CoTaskMemFree(Some(name_ptr.0 as *const _));
                                                            windows::Win32::System::Com::CoTaskMemFree(Some(val_ptr.0 as *const _));
                                                        }
                                                    }
                                                }

                                                if !sso.is_empty() && !php.is_empty() {
                                                    let cookie_header = format!("sso_session={}; PHPSESSID={}", sso, php);
                                                    crate::diagnostics::log(&format!("Captured full Erlangga session: sso_session + PHPSESSID"));

                                                    let _ = crate::commands::save_setting(
                                                        app_c.clone(),
                                                        "nectar-erlangga-cookies".to_string(),
                                                        serde_json::Value::String(cookie_header.clone()),
                                                    );
                                                    let _ = app_c.emit("erlangga-cookies-updated", cookie_header.clone());

                                                    let app_bg = app_c.clone();
                                                    tauri::async_runtime::spawn(async move {
                                                        let res = fetch_summary(&app_bg, Some(cookie_header), None).await;
                                                        match res {
                                                            Ok(s) => crate::diagnostics::log(&format!("DO Summary fetch success: total_rp={}", s.total_rp)),
                                                            Err(e) => crate::diagnostics::log(&format!("DO Summary fetch error: {e}")),
                                                        }
                                                        let _ = app_bg.emit("erlangga-data-refreshed", ());
                                                    });

                                                    let _ = win_c.close();
                                                } else if !sso.is_empty() && php.is_empty() {
                                                    crate::diagnostics::log("Captured sso_session, waiting for YESSS to establish PHPSESSID...");
                                                    
                                                    // 5-second fallback: if user stays on dashboard without navigating to YESSS, auto-exchange token
                                                    let app_fallback = app_c.clone();
                                                    let win_fallback = win_c.clone();
                                                    let sso_copy = sso.clone();
                                                    tauri::async_runtime::spawn(async move {
                                                        tokio::time::sleep(std::time::Duration::from_secs(5)).await;
                                                        let current = crate::utils::get_setting_str(&app_fallback, "nectar-erlangga-cookies");
                                                        if current.map(|c| !c.contains("PHPSESSID=")).unwrap_or(true) {
                                                            crate::diagnostics::log("Running fallback ensure_yesss_cookies token exchange...");
                                                            if let Some(new_cookies) = ensure_yesss_cookies(&sso_copy).await {
                                                                let _ = crate::commands::save_setting(
                                                                    app_fallback.clone(),
                                                                    "nectar-erlangga-cookies".to_string(),
                                                                    serde_json::Value::String(new_cookies.clone()),
                                                                );
                                                                let _ = app_fallback.emit("erlangga-cookies-updated", new_cookies.clone());
                                                                let app_bg = app_fallback.clone();
                                                                let _ = fetch_summary(&app_bg, Some(new_cookies), None).await;
                                                                let _ = app_bg.emit("erlangga-data-refreshed", ());
                                                                let _ = win_fallback.close();
                                                            }
                                                        }
                                                    });
                                                }
                                            }
                                        }
                                        Ok(())
                                    }));

                                    let _ = cm.GetCookies(windows_core::PCWSTR(domain_uri.as_ptr()), &handler);
                                }
                            }
                        }
                    }
                    Ok(())
                })),
                &mut nav_token,
            );
        });
    }

    Ok(())
}

pub fn start_keepalive_worker(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let mut interval = tokio::time::interval(std::time::Duration::from_secs(600)); // 10 minutes
        loop {
            interval.tick().await;

            let enabled = crate::utils::get_setting_str(&app, "nectar-erlangga-enabled")
                .map(|v| v != "false")
                .unwrap_or(true);

            if !enabled {
                continue;
            }

            let cookies = crate::utils::get_setting_str(&app, "nectar-erlangga-cookies");
            if let Some(cookie_str) = cookies {
                if cookie_str.trim().is_empty() {
                    continue;
                }
                crate::diagnostics::log("Erlangga keep-alive ping running...");
                let mut headers = HeaderMap::new();
                if let Ok(c) = HeaderValue::from_str(&cookie_str) {
                    headers.insert(COOKIE, c);
                }
                headers.insert(
                    USER_AGENT,
                    HeaderValue::from_static("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"),
                );
                if let Ok(client) = reqwest::Client::builder().default_headers(headers).build() {
                    let _ = client.get("https://apps.erlangga.id/yesss/info_do_summary.html").send().await;
                }
            }
        }
    });
}
