import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { mockWindows, mockIPC } from "@tauri-apps/api/mocks";

// Polyfill Tauri when running outside the native Tauri binary
if (typeof window !== "undefined" && !(window as any).__TAURI_INTERNALS__?.invoke) {
  try {
    mockWindows("main");
    mockIPC(
      async (cmd, args: any) => {
        if (cmd === "load_settings") {
          const settings: Record<string, any> = {};
          for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (k && k.startsWith("nectar-")) {
              settings[k] = localStorage.getItem(k);
            }
          }
          return settings;
        }
        if (cmd === "save_setting") {
          if (args?.key) {
            localStorage.setItem(args.key, String(args.value));
          }
          return null;
        }
        if (cmd === "get_active_windows") return [];
        if (cmd === "get_app_icon") return null;
        if (cmd === "get_installed_apps") return [];
        if (cmd === "get_media_info") return { has_media: false };
        if (cmd === "refresh_dock_mode") return null;
        if (cmd === "refresh_notch_mode") return null;
        return null;
      },
      { shouldMockEvents: true }
    );
  } catch (e) {
    console.warn("Tauri mock setup notice:", e);
  }
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
