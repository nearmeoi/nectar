import { useState, useRef, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { motion, AnimatePresence } from "framer-motion";
import {
  PackageCheck,
  RefreshCw,
  LogIn,
  Download,
  Play,
  Square,
  Folder,
  FolderOpen,
  Check,
} from "lucide-react";
import type { ErlanggaSummary } from "../hooks/useErlanggaStock";
import type { DailyDataHook } from "../hooks/useDailyData";

interface StockPanelProps {
  summary: ErlanggaSummary | null;
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
  onOpenSettings?: () => void;
  onExport?: () => Promise<string | void>;
  exporting?: boolean;
  exportPath?: string | null;
  dailyData: DailyDataHook;
}

const STAGE_NAMES: Record<number, string> = {
  1: "Tahap 1: Deteksi & Validasi File Input",
  2: "Tahap 2: Agregasi & Pivot STOK WH 56 Makassar",
  3: "Tahap 3: Filter 2026 & Pivot TRN (In-Transit)",
  4: "Tahap 4: Pivot SOOUT, Stok MKS & Batch FIFO",
  5: "Tahap 5: Pivot POOUT (Deliver Remainder)",
  6: "Tahap 6: Pengisian Nilai Format Cabang (22k baris)",
  7: "Tahap 7: Alokasi Buku Masuk & Ekstraksi FIFO",
  8: "Tahap 8: Pivot Tabular DO Summary External",
  9: "Tahap 9: Recheck SP Kemarin & Validasi Posting",
};

export function StockPanel({
  summary,
  loading,
  error,
  onRefresh,
  onExport,
  exporting = false,
  dailyData,
}: StockPanelProps) {
  const [internalExporting, setInternalExporting] = useState(false);
  const [showFolderMenu, setShowFolderMenu] = useState(false);
  const folderMenuRef = useRef<HTMLDivElement | null>(null);

  // Close folder menu on outside click
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (folderMenuRef.current && !folderMenuRef.current.contains(e.target as Node)) {
        setShowFolderMenu(false);
      }
    };
    if (showFolderMenu) {
      document.addEventListener("mousedown", handleOutsideClick);
    }
    return () => {
      document.removeEventListener("mousedown", handleOutsideClick);
    };
  }, [showFolderMenu]);

  const handleExport = async () => {
    if (onExport) {
      onExport();
      return;
    }
    setInternalExporting(true);
    try {
      await invoke("export_erlangga_do");
      dailyData.loadFolders();
    } catch (e) {
      console.error(e);
    } finally {
      setInternalExporting(false);
    }
  };

  const isExportLoading = exporting || internalExporting;

  const formattedRp = summary?.total_rp
    ? `Rp ${summary.total_rp.replace(/,/g, ".")}`
    : null;

  const statusColor =
    dailyData.statusText === "SUCCESS"
      ? "#10b981"
      : dailyData.statusText === "FAILED"
      ? "#ef4444"
      : dailyData.statusText === "RUNNING"
      ? "#38bdf8"
      : "rgba(255, 255, 255, 0.4)";

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        padding: "10px 14px 10px 14px",
        boxSizing: "border-box",
        color: "var(--nectar-text, #fff)",
        overflow: "hidden",
        userSelect: "none",
        position: "relative",
      }}
    >
      {/* ── 1. Top Header: Title & Actions ── */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexShrink: 0,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <PackageCheck size={14} strokeWidth={2.4} style={{ color: "#f59e0b" }} />
          <span
            style={{
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: "0.5px",
              textTransform: "uppercase",
              opacity: 0.95,
            }}
          >
            Daily Data
          </span>
        </div>

        {/* Action Buttons: [Login] [Export] [Refresh] */}
        <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
          <button
            onClick={() => invoke("open_erlangga_login")}
            title="Login Akun Erlangga"
            style={{
              background: "rgba(59, 130, 246, 0.15)",
              border: "1px solid rgba(59, 130, 246, 0.35)",
              borderRadius: 5,
              width: 26,
              height: 24,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
              color: "#60a5fa",
              transition: "all 0.15s ease",
            }}
          >
            <LogIn size={13} strokeWidth={2.2} />
          </button>

          <button
            onClick={handleExport}
            disabled={isExportLoading}
            title="Unduh DO Summary CSV"
            style={{
              background: "rgba(16, 185, 129, 0.15)",
              border: "1px solid rgba(16, 185, 129, 0.35)",
              borderRadius: 5,
              width: 26,
              height: 24,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: isExportLoading ? "wait" : "pointer",
              color: "#34d399",
              opacity: isExportLoading ? 0.6 : 1,
              transition: "all 0.15s ease",
            }}
          >
            <Download
              size={13}
              strokeWidth={2.2}
              style={{
                animation: isExportLoading ? "bounce 1s infinite" : undefined,
              }}
            />
          </button>

          <button
            onClick={onRefresh}
            disabled={loading}
            title="Segarkan Data Realisasi Rp"
            style={{
              background: "rgba(255, 255, 255, 0.08)",
              border: "1px solid rgba(255, 255, 255, 0.15)",
              borderRadius: 5,
              width: 26,
              height: 24,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: loading ? "wait" : "pointer",
              color: "inherit",
              opacity: loading ? 0.6 : 1,
              transition: "all 0.15s ease",
            }}
          >
            <RefreshCw
              size={13}
              strokeWidth={2.2}
              style={{
                animation: loading ? "spin 1s linear infinite" : undefined,
              }}
            />
          </button>
        </div>
      </div>

      {/* ── 2. Middle Hero: Angka Total Nominal Rp ── */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: "2px 0",
        }}
      >
        {error ? (
          <span style={{ fontSize: 14, fontWeight: 600, color: "#ef4444" }}>
            Gagal memuat data DO
          </span>
        ) : loading && !formattedRp ? (
          <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, opacity: 0.7 }}>
            <RefreshCw size={13} style={{ animation: "spin 1s linear infinite" }} />
            <span>Memuat realisasi...</span>
          </div>
        ) : formattedRp ? (
          <>
            <div
              style={{
                fontSize: 21,
                fontWeight: 700,
                letterSpacing: "-0.4px",
                color: "#ffffff",
                fontVariantNumeric: "tabular-nums",
                lineHeight: "24px",
              }}
            >
              {formattedRp}
            </div>
            <div style={{ fontSize: 9.5, color: "var(--nectar-muted, #94a3b8)", marginTop: 1 }}>
              Total Realisasi DO Makassar Hari Ini
            </div>
          </>
        ) : (
          <span style={{ fontSize: 14, fontWeight: 600, color: "#ef4444" }}>
            Data tidak tersedia
          </span>
        )}
      </div>

      {/* ── 3. Stage Buttons Row: [RUN] [1] [2] ... [9] ── */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 4,
          padding: "2px 0",
        }}
      >
        {/* Tombol Master RUN / STOP */}
        <button
          onClick={() => {
            if (dailyData.running) {
              dailyData.stopPipeline();
            } else {
              dailyData.runPipeline();
            }
          }}
          title={dailyData.running ? "Hentikan Pipeline" : "Jalankan Semua Tahap (1-9)"}
          style={{
            background: dailyData.running ? "#dc2626" : "#16a34a",
            border: "none",
            borderRadius: 5,
            padding: "0 8px",
            height: 23,
            display: "flex",
            alignItems: "center",
            gap: 4,
            cursor: "pointer",
            color: "#ffffff",
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: "0.4px",
            transition: "all 0.15s ease",
            flexShrink: 0,
          }}
        >
          {dailyData.running ? (
            <>
              <Square size={10} fill="#ffffff" />
              <span>STOP</span>
            </>
          ) : (
            <>
              <Play size={10} fill="#ffffff" />
              <span>RUN</span>
            </>
          )}
        </button>

        {/* 9 Stage Pills */}
        <div style={{ display: "flex", alignItems: "center", gap: 3, flex: 1, justifyContent: "space-between" }}>
          {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((stg) => {
            const st = dailyData.stageStatuses[stg] || "idle";
            const isCur = dailyData.currentStage === stg;
            const bg =
              isCur || st === "running"
                ? "rgba(2, 132, 199, 0.35)"
                : st === "success"
                ? "rgba(16, 185, 129, 0.2)"
                : st === "failed"
                ? "rgba(239, 68, 68, 0.25)"
                : "rgba(255, 255, 255, 0.07)";

            const border =
              isCur || st === "running"
                ? "1px solid #38bdf8"
                : st === "success"
                ? "1px solid #10b981"
                : st === "failed"
                ? "1px solid #ef4444"
                : "1px solid rgba(255, 255, 255, 0.15)";

            const color =
              isCur || st === "running"
                ? "#38bdf8"
                : st === "success"
                ? "#10b981"
                : st === "failed"
                ? "#ef4444"
                : "rgba(255, 255, 255, 0.7)";

            return (
              <button
                key={stg}
                onClick={() => dailyData.runPipeline([stg])}
                title={`${STAGE_NAMES[stg]} (Klik untuk eksekusi mandiri)`}
                disabled={dailyData.running}
                style={{
                  background: bg,
                  border: border,
                  borderRadius: 4,
                  width: 21,
                  height: 23,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 10,
                  fontWeight: 600,
                  color: color,
                  cursor: dailyData.running ? "not-allowed" : "pointer",
                  transition: "all 0.15s ease",
                  padding: 0,
                }}
              >
                {stg}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── 4. Bottom Row: Status Text + Lyrics-Style 1-Line Log + Folder Button ── */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          fontSize: 10,
          marginTop: 2,
        }}
      >
        {/* Status Text (Murni Teks tanpa lingkaran) */}
        <span
          style={{
            fontWeight: 800,
            letterSpacing: "0.5px",
            color: statusColor,
            flexShrink: 0,
            fontSize: 10,
          }}
        >
          {dailyData.statusText}
        </span>

        {/* 1-Line Lyrics Style Log (Framer Motion Slide-Up Transition) */}
        <div
          style={{
            flex: 1,
            height: 18,
            overflow: "hidden",
            position: "relative",
            display: "flex",
            alignItems: "center",
          }}
        >
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.div
              key={dailyData.lyricsLog}
              initial={{ y: 8, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: -8, opacity: 0 }}
              transition={{ duration: 0.22, ease: "easeOut" }}
              title={dailyData.lyricsLog}
              style={{
                width: "100%",
                color: "#ffffff",
                fontSize: 10.5,
                fontWeight: 500,
                letterSpacing: "0.1px",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
                lineHeight: "18px",
              }}
            >
              {dailyData.lyricsLog}
            </motion.div>
          </AnimatePresence>
        </div>

        {/* Folder Icon Button (Kanan Bawah) */}
        <div style={{ position: "relative" }} ref={folderMenuRef}>
          <button
            onClick={() => setShowFolderMenu((prev) => !prev)}
            title={`Folder Aktif: ${dailyData.selectedFolder || "Pilih folder"}\nKlik untuk ganti folder / buka Explorer`}
            style={{
              background: "rgba(255, 255, 255, 0.08)",
              border: "1px solid rgba(255, 255, 255, 0.2)",
              borderRadius: 5,
              padding: "2px 6px",
              height: 22,
              display: "flex",
              alignItems: "center",
              gap: 4,
              cursor: "pointer",
              color: "#ffffff",
              fontSize: 9.5,
              fontWeight: 600,
              transition: "all 0.15s ease",
              flexShrink: 0,
            }}
          >
            <Folder size={12} strokeWidth={2.2} style={{ color: "#60a5fa" }} />
            <span>
              {dailyData.selectedFolder
                ? dailyData.selectedFolder.replace(/2026/g, "").trim() || dailyData.selectedFolder
                : "Folder"}
            </span>
          </button>

          {/* Mini Folder Popover Menu */}
          {showFolderMenu && (
            <div
              style={{
                position: "absolute",
                bottom: 26,
                right: 0,
                background: "rgba(15, 23, 42, 0.95)",
                backdropFilter: "blur(12px)",
                border: "1px solid rgba(255, 255, 255, 0.18)",
                borderRadius: 6,
                padding: "4px 0",
                width: 150,
                zIndex: 100,
                boxShadow: "0 8px 24px rgba(0, 0, 0, 0.5)",
              }}
            >
              <div
                style={{
                  fontSize: 9,
                  fontWeight: 700,
                  color: "var(--nectar-muted, #94a3b8)",
                  padding: "4px 8px",
                  letterSpacing: "0.5px",
                  textTransform: "uppercase",
                  borderBottom: "1px solid rgba(255, 255, 255, 0.08)",
                }}
              >
                Pilih Tanggal Data
              </div>
              {dailyData.folders.slice(0, 5).map((f) => (
                <div
                  key={f.name}
                  onClick={() => {
                    dailyData.setSelectedFolder(f.name);
                    setShowFolderMenu(false);
                  }}
                  style={{
                    padding: "5px 8px",
                    fontSize: 10,
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    background:
                      dailyData.selectedFolder === f.name
                        ? "rgba(59, 130, 246, 0.2)"
                        : "transparent",
                    color: dailyData.selectedFolder === f.name ? "#60a5fa" : "#ffffff",
                  }}
                >
                  <span>{f.name}</span>
                  {dailyData.selectedFolder === f.name && <Check size={11} strokeWidth={2.5} />}
                </div>
              ))}
              <div
                onClick={() => {
                  dailyData.openCurrentFolder();
                  setShowFolderMenu(false);
                }}
                style={{
                  padding: "5px 8px",
                  fontSize: 10,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: 5,
                  borderTop: "1px solid rgba(255, 255, 255, 0.08)",
                  color: "#34d399",
                }}
              >
                <FolderOpen size={11} />
                <span>Buka di Explorer</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
