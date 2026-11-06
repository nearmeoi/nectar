import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { ChevronLeft, PackageCheck, RefreshCw, Check, AlertCircle, Cookie, Building2, Timer, Calendar, LogIn } from "lucide-react";
import { SettingRow } from "./SettingRow";
import { Dropdown } from "./Dropdown";
import { DEFAULT_ERLANGGA_COOKIES, DEFAULT_ERLANGGA_WH } from "../hooks/useErlanggaStock";

interface StockSettingsPageProps {
  onBack: () => void;
}

export function StockSettingsPage({ onBack }: StockSettingsPageProps) {
  const [enabled, setEnabled] = useState(
    () => localStorage.getItem("nectar-erlangga-enabled") !== "false"
  );
  const [cookies, setCookies] = useState(
    () => localStorage.getItem("nectar-erlangga-cookies") || DEFAULT_ERLANGGA_COOKIES
  );
  const [wh, setWh] = useState(
    () => localStorage.getItem("nectar-erlangga-wh") || DEFAULT_ERLANGGA_WH
  );
  const [interval, setIntervalVal] = useState(
    () => localStorage.getItem("nectar-erlangga-interval") || "15"
  );
  const [date, setDate] = useState(
    () => localStorage.getItem("nectar-erlangga-date") || new Date().toISOString().slice(0, 10)
  );

  const [busy, setBusy] = useState(false);
  const [statusMsg, setStatusMsg] = useState<{ text: string; ok: boolean } | null>(null);

  const saveSetting = (key: string, val: string) => {
    localStorage.setItem(key, val);
    invoke("save_setting", { key, value: val }).catch(console.error);
  };

  const handleToggle = () => {
    const next = !enabled;
    setEnabled(next);
    saveSetting("nectar-erlangga-enabled", String(next));
  };

  const handleCookiesChange = (val: string) => {
    setCookies(val);
    saveSetting("nectar-erlangga-cookies", val);
  };

  const handleWhChange = (val: string) => {
    setWh(val);
    saveSetting("nectar-erlangga-wh", val);
  };

  const handleIntervalChange = (val: string) => {
    setIntervalVal(val);
    saveSetting("nectar-erlangga-interval", val);
  };

  const handleDateChange = (val: string) => {
    setDate(val);
    saveSetting("nectar-erlangga-date", val);
  };

  
  useEffect(() => {
    const unlisten = listen<string>("erlangga-cookies-updated", (event) => {
      if (event.payload) {
        setCookies(event.payload);
        setStatusMsg({
          ok: true,
          text: "Login berhasil! Sesi otomatis tersambung dan tersimpan.",
        });
      }
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  const handleLoginClick = async () => {
    try {
      await invoke("open_erlangga_login");
    } catch (e) {
      setStatusMsg({ ok: false, text: String(e) });
    }
  };

  const testConnection = async () => {
    setBusy(true);
    setStatusMsg(null);
    try {
      const res = await invoke<any>("refresh_erlangga_summary", {
        cookies: cookies.trim(),
        wh: wh.trim(),
      });
      if (res && res.total_qty !== undefined) {
        setStatusMsg({
          ok: true,
          text: `Berhasil terhubung! Total Qty: ${res.total_qty.toLocaleString()} (${res.total_items} item).`,
        });
      } else {
        setStatusMsg({ ok: false, text: "Gagal memuat format data dari server." });
      }
    } catch (err: any) {
      setStatusMsg({
        ok: false,
        text: typeof err === "string" ? err : err?.message || "Koneksi gagal. Periksa cookie Anda.",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="subpage">
      <div className="subpage-header">
        <button className="subpage-back" onClick={onBack} title="Kembali">
          <ChevronLeft size={16} />
        </button>
        <span className="subpage-title">Erlangga DO Stock</span>
      </div>

      <div className="subpage-content">
        <SettingRow
          icon={PackageCheck}
          label="Aktifkan DO Stock"
          desc="Tampilkan widget dan panel ringkasan DO di Notch Nectar"
        >
          <label className="toggle-switch">
            <input type="checkbox" checked={enabled} onChange={handleToggle} />
            <span className="slider"></span>
          </label>
        </SettingRow>

        
        {/* Quick Login Section */}
        <div
          style={{
            margin: "4px 16px 14px",
            padding: "12px 14px",
            background: "rgba(59, 130, 246, 0.1)",
            border: "1px solid rgba(59, 130, 246, 0.25)",
            borderRadius: 10,
            display: "flex",
            flexDirection: "column",
            gap: 10,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600 }}>Login Otomatis In-App</div>
              <div style={{ fontSize: 11, color: "var(--nectar-text-muted, rgba(255,255,255,0.65))", marginTop: 2 }}>
                Login sekali di jendela resmi Erlangga. Sesi otomatis ditangkap dan dijaga tetap aktif oleh Nectar.
              </div>
            </div>
            <button
              onClick={handleLoginClick}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "7px 14px",
                borderRadius: 7,
                background: "#3b82f6",
                color: "#fff",
                border: 0,
                fontSize: 12,
                fontWeight: 600,
                cursor: "pointer",
                whiteSpace: "nowrap",
              }}
            >
              <LogIn size={14} />
              Login Erlangga
            </button>
          </div>
        </div>

        <SettingRow
          icon={Cookie}
          label="Session Cookies"
          desc="Cookie autentikasi dari apps.erlangga.id (sso_session & PHPSESSID)"
        >
          <div style={{ width: "100%", marginTop: 8 }}>
            <textarea
              rows={3}
              value={cookies}
              onChange={(e) => handleCookiesChange(e.target.value)}
              placeholder="sso_session=...; PHPSESSID=..."
              style={{
                width: "100%",
                background: "var(--nectar-input-bg, rgba(255, 255, 255, 0.08))",
                border: "1px solid var(--nectar-border, rgba(255, 255, 255, 0.15))",
                borderRadius: 6,
                padding: "6px 8px",
                fontSize: 11,
                fontFamily: "monospace",
                color: "inherit",
                resize: "vertical",
                boxSizing: "border-box",
                outline: "none",
              }}
            />
          </div>
        </SettingRow>

        <SettingRow
          icon={Building2}
          label="Unit Gudang (BU)"
          desc="Kode warehouse pengiriman DO (default: 56|56)"
        >
          <input
            type="text"
            value={wh}
            onChange={(e) => handleWhChange(e.target.value)}
            style={{
              width: 120,
              height: 28,
              background: "var(--nectar-input-bg, rgba(255, 255, 255, 0.08))",
              border: "1px solid var(--nectar-border, rgba(255, 255, 255, 0.15))",
              borderRadius: 6,
              padding: "0 8px",
              fontSize: 12,
              color: "inherit",
              outline: "none",
            }}
          />
        </SettingRow>

        <SettingRow
          icon={Calendar}
          label="Tanggal Rekap DO"
          desc="Pilih tanggal transaksi DO yang ingin dipantau"
        >
          <input
            type="date"
            value={date}
            onChange={(e) => handleDateChange(e.target.value)}
            style={{
              height: 28,
              background: "var(--nectar-input-bg, rgba(255, 255, 255, 0.08))",
              border: "1px solid var(--nectar-border, rgba(255, 255, 255, 0.15))",
              borderRadius: 6,
              padding: "0 8px",
              fontSize: 12,
              color: "inherit",
              outline: "none",
            }}
          />
        </SettingRow>

        <SettingRow
          icon={Timer}
          label="Interval Pembaruan Otomatis"
          desc="Berapa menit sekali Nectar memperbarui data stok DO"
        >
          <Dropdown
            value={interval}
            onChange={handleIntervalChange}
            options={[
              { value: "5", label: "Setiap 5 menit" },
              { value: "10", label: "Setiap 10 menit" },
              { value: "15", label: "Setiap 15 menit (Default)" },
              { value: "30", label: "Setiap 30 menit" },
              { value: "60", label: "Setiap 1 jam" },
            ]}
          />
        </SettingRow>

        <div style={{ padding: "12px 16px", display: "flex", flexDirection: "column", gap: 10 }}>
          <button
            onClick={testConnection}
            disabled={busy}
            style={{
              height: 32,
              borderRadius: 8,
              background: "var(--nectar-accent, #3b82f6)",
              border: 0,
              color: "#fff",
              fontSize: 12,
              fontWeight: 600,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              opacity: busy ? 0.7 : 1,
            }}
          >
            <RefreshCw
              size={13}
              style={{ animation: busy ? "spin 1s linear infinite" : undefined }}
            />
            {busy ? "Memeriksa Koneksi..." : "Uji Koneksi & Ambil Data"}
          </button>

          {statusMsg && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "8px 12px",
                borderRadius: 8,
                fontSize: 12,
                background: statusMsg.ok
                  ? "rgba(34, 197, 94, 0.15)"
                  : "rgba(239, 68, 68, 0.15)",
                border: `1px solid ${
                  statusMsg.ok ? "rgba(34, 197, 94, 0.3)" : "rgba(239, 68, 68, 0.3)"
                }`,
                color: statusMsg.ok ? "#4ade80" : "#f87171",
              }}
            >
              {statusMsg.ok ? <Check size={14} /> : <AlertCircle size={14} />}
              <span>{statusMsg.text}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
