import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { setVisibleInterval } from "./visibleInterval";

export interface ErlanggaItem {
  no: number;
  do_number: string;
  tgl_do: string;
  po: string;
  item_code: string;
  item_name: string;
  qty: number;
  sisa: number;
  rp: string;
  status: string;
  modified_by: string;
  pelanggan: string;
  guru: string;
  sales: string;
}

export interface ErlanggaSummary {
  title: string;
  total_qty: number;
  total_sisa: number;
  total_rp: string;
  total_items: number;
  close_count: number;
  on_order_count: number;
  last_updated: number;
  items: ErlanggaItem[];
  error?: string | null;
}

export const DEFAULT_ERLANGGA_COOKIES = "";
export const DEFAULT_ERLANGGA_WH = "56|56";

export const SAMPLE_SUMMARY: ErlanggaSummary = {
  title: "Rekap DO External SUMMARY",
  total_qty: 1397,
  total_sisa: 30,
  total_rp: "96,485,100",
  total_items: 227,
  close_count: 195,
  on_order_count: 32,
  last_updated: Math.floor(Date.now() / 1000),
  items: [
    {
      no: 1,
      do_number: "5600001086",
      tgl_do: "2026-11-04",
      po: "2410-0012",
      item_code: "0022970030",
      item_name: "BUKU PENDIDIKAN AGAMA ISLAM DAN BUDI PEKERTI JL.3/KM",
      qty: 10,
      sisa: 0,
      rp: "650,000",
      status: "Close",
      modified_by: "ADMIN",
      pelanggan: "SDN 01 PAGI JAKARTA",
      guru: "H. SULAIMAN S.Pd",
      sales: "AHMAD FAUZI",
    },
    {
      no: 2,
      do_number: "5600001087",
      tgl_do: "2026-11-04",
      po: "2410-0013",
      item_code: "0025000040",
      item_name: "ESPS IPAS SD/MI KLS.4/KM",
      qty: 25,
      sisa: 5,
      rp: "2,450,000",
      status: "On Order",
      modified_by: "ADMIN",
      pelanggan: "SDIT INSAN KAMIL",
      guru: "SITI MARYAM S.Pd",
      sales: "BUDI SANTOSO",
    },
    {
      no: 3,
      do_number: "5600001088",
      tgl_do: "2026-11-04",
      po: "2410-0014",
      item_code: "0025100010",
      item_name: "MATEMATIKA SD/MI KLS.1/KM",
      qty: 50,
      sisa: 0,
      rp: "4,100,000",
      status: "Close",
      modified_by: "LOGISTIK",
      pelanggan: "SDN KEBON JERUK 02",
      guru: "RUDI HARTONO S.Pd",
      sales: "DEDI KURNIAWAN",
    },
    {
      no: 4,
      do_number: "5600001089",
      tgl_do: "2026-11-04",
      po: "2410-0015",
      item_code: "0024100020",
      item_name: "BAHASA INDONESIA SD/MI KLS.2/KM",
      qty: 15,
      sisa: 2,
      rp: "1,275,000",
      status: "On Order",
      modified_by: "ADMIN",
      pelanggan: "MIN 1 JAKARTA",
      guru: "NURUL HIDAYAH",
      sales: "AHMAD FAUZI",
    },
    {
      no: 5,
      do_number: "5600001090",
      tgl_do: "2026-11-04",
      po: "2410-0016",
      item_code: "0033000050",
      item_name: "PENDIDIKAN PANCASILA SMP KLS.7/KM",
      qty: 30,
      sisa: 0,
      rp: "2,850,000",
      status: "Close",
      modified_by: "LOGISTIK",
      pelanggan: "SMPN 115 JAKARTA",
      guru: "BAMBANG IRAWAN M.Pd",
      sales: "HENDRA WIJAYA",
    },
    {
      no: 6,
      do_number: "5600001091",
      tgl_do: "2026-11-04",
      po: "2410-0017",
      item_code: "0035000020",
      item_name: "IPA SMP KLS.8/KM",
      qty: 40,
      sisa: 10,
      rp: "3,800,000",
      status: "On Order",
      modified_by: "ADMIN",
      pelanggan: "SMP AL-AZHAR 1",
      guru: "RATNA DEWI S.Si",
      sales: "BUDI SANTOSO",
    },
    {
      no: 7,
      do_number: "5600001092",
      tgl_do: "2026-11-04",
      po: "2410-0018",
      item_code: "0045000010",
      item_name: "FISIKA SMA/MA KLS.10/KM",
      qty: 20,
      sisa: 0,
      rp: "2,100,000",
      status: "Close",
      modified_by: "LOGISTIK",
      pelanggan: "SMAN 8 JAKARTA",
      guru: "DRS. M. YUSUF",
      sales: "DEDI KURNIAWAN",
    },
    {
      no: 8,
      do_number: "5600001093",
      tgl_do: "2026-11-04",
      po: "2410-0019",
      item_code: "0045100030",
      item_name: "KIMIA SMA/MA KLS.11/KM",
      qty: 35,
      sisa: 13,
      rp: "3,675,000",
      status: "On Order",
      modified_by: "ADMIN",
      pelanggan: "SMA LABSCHOOL",
      guru: "ENDAH LESTARI M.Si",
      sales: "HENDRA WIJAYA",
    },
  ],
};

const CACHE_KEY = "nectar-erlangga-cache";

function readCache(): ErlanggaSummary | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed.total_rp === "string") {
        return parsed;
      }
    }
  } catch {}
  return null;
}

function writeCache(summary: ErlanggaSummary) {
  try {
    if (summary.total_qty > 0 || (summary.items && summary.items.length > 0)) {
      localStorage.setItem(CACHE_KEY, JSON.stringify(summary));
    }
  } catch {}
}

export function parseErlanggaHtml(html: string): ErlanggaSummary {
  const headerMatch = html.match(/<div class="table-header">([\s\S]*?)<\/div>/i);
  const title = headerMatch ? headerMatch[1].trim() : "Rekap DO External SUMMARY";

  // Total Row
  const totalMatch = html.match(
    /<tr[^>]*class=['"]active['"][^>]*>[\s\S]*?TOTAL[\s\S]*?<th[^>]*>([\d,\.]+)<\/th>[\s\S]*?<th[^>]*>([\d,\.]+)<\/th>[\s\S]*?<th[^>]*>([\d,\.]+)<\/th>/i
  );

  let total_qty = 0;
  let total_sisa = 0;
  let total_rp = "0";

  if (totalMatch) {
    total_qty = parseInt(totalMatch[1].replace(/,/g, ""), 10) || 0;
    total_sisa = parseInt(totalMatch[2].replace(/,/g, ""), 10) || 0;
    total_rp = totalMatch[3].trim();
  }

  const items: ErlanggaItem[] = [];
  let close_count = 0;
  let on_order_count = 0;

  const rowMatches = [...html.matchAll(/<tr>\s*<td class='text-center'>(\d+)<\/td>([\s\S]*?)<\/tr>/gi)];
  for (const m of rowMatches) {
    const no = parseInt(m[1], 10);
    const rowContent = m[2];
    const cells = [...rowContent.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((c) =>
      c[1].replace(/<[^>]+>/g, "").trim()
    );

    if (cells.length >= 8) {
      const status = cells[8] || "";
      if (status.toLowerCase().includes("close")) close_count++;
      else if (status.toLowerCase().includes("order")) on_order_count++;

      items.push({
        no,
        do_number: cells[0] || "",
        tgl_do: cells[1] || "",
        po: cells[2] || "",
        item_code: cells[3] || "",
        item_name: cells[4] || "",
        qty: parseInt((cells[5] || "0").replace(/,/g, ""), 10) || 0,
        sisa: parseInt((cells[6] || "0").replace(/,/g, ""), 10) || 0,
        rp: cells[7] || "0",
        status,
        modified_by: cells[9] || "",
        pelanggan: cells[10] || "",
        guru: cells[11] || "",
        sales: cells[12] || "",
      });
    }
  }

  return {
    title,
    total_qty,
    total_sisa,
    total_rp,
    total_items: items.length,
    close_count,
    on_order_count,
    last_updated: Math.floor(Date.now() / 1000),
    items,
  };
}

export function useErlanggaStock(enabled: boolean = true) {
  const [summary, setSummary] = useState<ErlanggaSummary | null>(() => readCache());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportPath, setExportPath] = useState<string | null>(null);

  const cookiesRef = useRef(
    localStorage.getItem("nectar-erlangga-cookies") || ""
  );
  const whRef = useRef(localStorage.getItem("nectar-erlangga-wh") || DEFAULT_ERLANGGA_WH);
  const intervalMinutes = parseInt(localStorage.getItem("nectar-erlangga-interval") || "15", 10);

  const fetchStock = useCallback(async (customCookies?: string, customWh?: string) => {
    setLoading(true);
    setError(null);
    const activeCookies = customCookies || cookiesRef.current || null;
    const activeWh = customWh || whRef.current || null;

    try {
      // 1. Try Tauri Rust backend command first
      try {
        const res = await invoke<ErlanggaSummary>("refresh_erlangga_summary", {
          cookies: activeCookies,
          wh: activeWh,
        });
        if (res) {
          if (res.error) {
            setError(res.error);
          } else {
            setSummary(res);
            writeCache(res);
            setError(null);
          }
          setLoading(false);
          return;
        }
      } catch (tauriErr: any) {
        const msg = typeof tauriErr === "string" ? tauriErr : (tauriErr?.message || "Failed to fetch stock summary");
        setError(msg);
        setLoading(false);
        return;
      }

      // 2. Direct fallback (in case Tauri command is unavailable in pure dev preview)
      const now = new Date();
      const body = new URLSearchParams({
        opsi: "1",
        wh: activeWh || DEFAULT_ERLANGGA_WH,
        status: "all",
        tahun: now.getFullYear().toString(),
        tgl1: now.getDate().toString(),
        bulan1: (now.getMonth() + 1).toString(),
        tgl2: now.getDate().toString(),
        bulan2: (now.getMonth() + 1).toString(),
      });

      const res = await fetch("https://apps.erlangga.id/yesss/info_do_summary/get_data.html", {
        method: "POST",
        headers: {
          accept: "text/html, */*; q=0.01",
          "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
          cookie: activeCookies || "",
          origin: "https://apps.erlangga.id",
          referer: "https://apps.erlangga.id/yesss/info_do_summary.html",
          "user-agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
          "x-requested-with": "XMLHttpRequest",
        },
        body: body.toString(),
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      }

      const html = await res.text();
      if (html.includes("exeption/forbidden.html") || html.includes("Sign In")) {
        throw new Error("Session expired or forbidden. Please update session cookies in settings.");
      }

      const parsed = parseErlanggaHtml(html);
      setSummary(parsed);
      writeCache(parsed);
    } catch (err: any) {
      const msg = err?.message || String(err) || "Failed to fetch stock summary";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  const exportData = useCallback(async () => {
    setExporting(true);
    try {
      const savedPath = await invoke<string>("export_erlangga_do");
      setExportPath(savedPath);
      setTimeout(() => setExportPath(null), 5000);
      return savedPath;
    } catch (err: any) {
      const msg = typeof err === "string" ? err : err?.message || "Gagal export data";
      setError(msg);
      throw err;
    } finally {
      setExporting(false);
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    fetchStock();
    const intervalMs = Math.max(intervalMinutes, 1) * 60 * 1000;
    const intervalId = setVisibleInterval(fetchStock, intervalMs);
    return () => clearInterval(intervalId);
  }, [enabled, fetchStock, intervalMinutes]);

  useEffect(() => {
    const u1 = listen("erlangga-data-refreshed", () => {
      fetchStock();
    });
    const u2 = listen<string>("erlangga-cookies-updated", (e) => {
      if (e.payload) {
        cookiesRef.current = e.payload;
        try {
          localStorage.setItem("nectar-erlangga-cookies", e.payload);
        } catch {}
        fetchStock(e.payload);
      }
    });
    return () => {
      u1.then((fn) => fn());
      u2.then((fn) => fn());
    };
  }, [fetchStock]);


  return {
    summary,
    loading,
    error,
    refresh: fetchStock,
    exportData,
    exporting,
    exportPath,
  };
}
