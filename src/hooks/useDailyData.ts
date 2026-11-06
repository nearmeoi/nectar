import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export interface FolderInfo {
  name: string;
  path: string;
  is_today: boolean;
}

export interface StageEvent {
  stage: number;
  name: string;
  status: "running" | "success" | "failed" | "skipped";
}

export interface LogEvent {
  raw: string;
  humanized: string;
  stage: number;
  is_error: boolean;
}

export interface FinishEvent {
  success: boolean;
  message: string;
  duration_sec: number;
}

export interface DailyDataHook {
  folders: FolderInfo[];
  selectedFolder: string;
  setSelectedFolder: (folder: string) => void;
  running: boolean;
  currentStage: number;
  statusText: "READY" | "RUNNING" | "SUCCESS" | "FAILED";
  lyricsLog: string;
  stageStatuses: Record<number, "idle" | "running" | "success" | "failed">;
  runPipeline: (stages?: number[]) => Promise<void>;
  stopPipeline: () => Promise<void>;
  openCurrentFolder: () => Promise<void>;
  loadFolders: () => Promise<void>;
}

export function useDailyData(): DailyDataHook {
  const [folders, setFolders] = useState<FolderInfo[]>([]);
  const [selectedFolder, setSelectedFolder] = useState<string>("");
  const [running, setRunning] = useState<boolean>(false);
  const [currentStage, setCurrentStage] = useState<number>(0);
  const [statusText, setStatusText] = useState<"READY" | "RUNNING" | "SUCCESS" | "FAILED">("READY");
  const [lyricsLog, setLyricsLog] = useState<string>("Siap dijalankan");
  const [stageStatuses, setStageStatuses] = useState<Record<number, "idle" | "running" | "success" | "failed">>({
    1: "idle",
    2: "idle",
    3: "idle",
    4: "idle",
    5: "idle",
    6: "idle",
    7: "idle",
    8: "idle",
    9: "idle",
  });

  const clearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Muat daftar folder harian saat inisialisasi
  const loadFolders = useCallback(async () => {
    try {
      const list = await invoke<FolderInfo[]>("get_daily_data_folders");
      setFolders(list);
      if (list.length > 0 && !selectedFolder) {
        // Otomatis pilih folder hari ini jika ada, atau folder teratas
        const today = list.find((f) => f.is_today);
        setSelectedFolder((today || list[0]).name);
      }
    } catch (e) {
      console.error("Gagal memuat folder Daily Data:", e);
    }
  }, [selectedFolder]);

  useEffect(() => {
    loadFolders();
  }, [loadFolders]);

  // Event Listeners dari backend Rust
  useEffect(() => {
    let unlistenLog: (() => void) | undefined;
    let unlistenStage: (() => void) | undefined;
    let unlistenFinish: (() => void) | undefined;

    const setupListeners = async () => {
      unlistenLog = await listen<LogEvent>("daily-data-log", (event) => {
        const payload = event.payload;
        if (payload.humanized && payload.humanized.trim()) {
          setLyricsLog(payload.humanized);
        }
        if (payload.is_error) {
          setStatusText("FAILED");
        }
      });

      unlistenStage = await listen<StageEvent>("daily-data-stage", (event) => {
        const payload = event.payload;
        setCurrentStage(payload.stage);
        setStatusText("RUNNING");
        setStageStatuses((prev) => ({
          ...prev,
          [payload.stage]: payload.status === "failed" ? "failed" : "running",
        }));
      });

      unlistenFinish = await listen<FinishEvent>("daily-data-finish", (event) => {
        const payload = event.payload;
        setRunning(false);
        setCurrentStage(0);
        if (payload.success) {
          setStatusText("SUCCESS");
          setLyricsLog(payload.message || "Selesai 100%");
          setStageStatuses((prev) => {
            const next = { ...prev };
            for (let i = 1; i <= 9; i++) {
              if (next[i] === "running") next[i] = "success";
            }
            return next;
          });
        } else {
          setStatusText("FAILED");
          setLyricsLog(payload.message || "Proses terhenti");
        }

        // Kembali ke READY setelah 6 detik jika sukses
        if (payload.success) {
          clearTimeout(clearTimerRef.current ?? undefined);
          clearTimerRef.current = setTimeout(() => {
            setStatusText("READY");
            setLyricsLog("Siap dijalankan");
          }, 6000);
        }
      });
    };

    setupListeners();

    return () => {
      if (unlistenLog) unlistenLog();
      if (unlistenStage) unlistenStage();
      if (unlistenFinish) unlistenFinish();
      clearTimeout(clearTimerRef.current ?? undefined);
    };
  }, []);

  const runPipeline = useCallback(
    async (stages?: number[]) => {
      if (running) return;
      setRunning(true);
      setStatusText("RUNNING");
      setLyricsLog("Memulai pipeline...");
      
      // Reset statuses
      setStageStatuses((prev) => {
        const next = { ...prev };
        for (let i = 1; i <= 9; i++) {
          if (!stages || stages.includes(i)) {
            next[i] = "idle";
          }
        }
        return next;
      });

      try {
        await invoke<FinishEvent>("run_daily_data", {
          folder: selectedFolder || undefined,
          stages: stages || undefined,
        });
      } catch (err) {
        setRunning(false);
        setStatusText("FAILED");
        setLyricsLog(String(err));
      }
    },
    [running, selectedFolder]
  );

  const stopPipeline = useCallback(async () => {
    try {
      await invoke("stop_daily_data");
      setRunning(false);
      setStatusText("READY");
      setLyricsLog("Proses dibatalkan.");
    } catch (err) {
      console.error("Gagal menghentikan proses:", err);
    }
  }, []);

  const openCurrentFolder = useCallback(async () => {
    const fObj = folders.find((f) => f.name === selectedFolder);
    const targetPath = fObj ? fObj.path : undefined;
    try {
      await invoke("open_daily_data_folder", { path: targetPath });
    } catch (err) {
      console.error("Gagal membuka folder:", err);
    }
  }, [folders, selectedFolder]);

  return {
    folders,
    selectedFolder,
    setSelectedFolder,
    running,
    currentStage,
    statusText,
    lyricsLog,
    stageStatuses,
    runPipeline,
    stopPipeline,
    openCurrentFolder,
    loadFolders,
  };
}
