import {
  DEFAULTS,
  HISTORY_CHECK_FIELDS,
  HISTORY_EXTRA_FIELDS,
  HISTORY_KEY,
  HISTORY_SETTING_FIELDS,
} from "../constants";
import type { HistoryJob, JobObject, JobSettings } from "../types";

export function defaultSettings(): JobSettings {
  return {
    bed: "333x88",
    bedW: 333,
    bedH: 418,
    spacingX: DEFAULTS.spacingX,
    spacingY: DEFAULTS.spacingY,
    marginX: DEFAULTS.marginX,
    marginY: DEFAULTS.marginY,
    objGap: DEFAULTS.objGap,
    footprint: "bed",
    offsetPct: DEFAULTS.offsetPct,
    matThk: DEFAULTS.matThk,
    pickDia: DEFAULTS.pickDia,
    baseThk: DEFAULTS.baseThk,
    pocketDepth: DEFAULTS.pocketDepth,
    dpi: DEFAULTS.dpi,
    center: true,
    nest: true,
    pickOut: false,
    showNum: true,
    useAdapter: false,
    scaleComp: true,
    maxPrintBed: DEFAULTS.maxPrintBed,
    splitPlate: false,
  };
}

export function newObject(index: number): JobObject {
  return {
    id: "o" + Math.random().toString(36).slice(2, 9),
    name: index === 0 ? "rect" : "",
    count: index === 0 ? DEFAULTS.qty : 1,
    up: "z+",
    rot: 0,
    mirror: false,
    auto: false,
    mode: "rectangle",
    clear: DEFAULTS.clearance,
    holes: "none",
    stlName: null,
    stl: null,
    rectW: DEFAULTS.rectW,
    rectH: DEFAULTS.rectH,
  };
}

export function bytesToB64(buf: ArrayBuffer): string {
  const u8 = new Uint8Array(buf);
  const chunks: string[] = [];
  for (let i = 0; i < u8.length; i += 32768) {
    chunks.push(String.fromCharCode(...u8.subarray(i, i + 32768)));
  }
  return btoa(chunks.join(""));
}

export function b64ToBytes(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return u8.buffer;
}

export function serializeJob(
  name: string,
  settings: JobSettings,
  objects: JobObject[],
  stlMap: Record<string, ArrayBuffer | null>,
  moves: Record<string, [number, number]>,
): HistoryJob {
  const rec: Record<string, string | number | boolean> = {};
  for (const k of HISTORY_SETTING_FIELDS) rec[k] = settings[k] as string | number;
  for (const k of HISTORY_CHECK_FIELDS) rec[k] = settings[k] as boolean;
  rec.scaleComp = settings.scaleComp;
  rec.maxPrintBed = settings.maxPrintBed;
  rec.splitPlate = settings.splitPlate;

  return {
    id: "h" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    name,
    date: new Date().toISOString(),
    settings: rec,
    objects: objects
      .filter((o) => o.stl || o.rectW)
      .map((o) => ({
        name: o.name,
        count: o.count,
        up: o.up,
        rot: o.rot,
        mirror: o.mirror,
        auto: o.auto,
        mode: o.mode,
        clear: o.clear,
        holes: o.holes,
        stlName: o.stlName || o.name || "model",
        stl: stlMap[o.id] ? bytesToB64(stlMap[o.id] as ArrayBuffer) : undefined,
        rectW: o.rectW,
        rectH: o.rectH,
      })),
    moves: Object.keys(moves).length ? { ...moves } : undefined,
  };
}

export function applyHistorySettings(raw: Record<string, unknown> | HistoryJob["settings"]): JobSettings {
  const s = defaultSettings();
  const numKeys = new Set([
    "bedW",
    "bedH",
    "spacingX",
    "spacingY",
    "marginX",
    "marginY",
    "objGap",
    "offsetPct",
    "matThk",
    "pickDia",
    "baseThk",
    "pocketDepth",
    "dpi",
    "maxPrintBed",
  ]);
  const boolKeys = new Set<string>([
    ...HISTORY_CHECK_FIELDS,
    ...HISTORY_EXTRA_FIELDS.filter((k) => k !== "maxPrintBed"),
  ]);
  for (const [k, v] of Object.entries(raw)) {
    if (v == null) continue;
    if (k === "bed" && (v === "333x88" || v === "333x418" || v === "custom")) s.bed = v;
    else if (k === "footprint" && (v === "bed" || v === "tight")) s.footprint = v;
    else if (numKeys.has(k) && k in s) (s as unknown as Record<string, number>)[k] = typeof v === "number" ? v : parseFloat(String(v));
    else if (boolKeys.has(k) && k in s) {
      (s as unknown as Record<string, boolean>)[k] = v === true || v === "true";
    }
  }
  return s;
}

export function loadHistory(): HistoryJob[] {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
  } catch {
    return [];
  }
}

export function saveHistory(jobs: HistoryJob[]): boolean {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(jobs));
    return true;
  } catch {
    return false;
  }
}

export function mergeImported(existing: HistoryJob[], incoming: unknown): { jobs: HistoryJob[]; added: number } {
  const list = Array.isArray(incoming) ? incoming : [incoming];
  const ids = new Set(existing.map((j) => j.id));
  let added = 0;
  const jobs = existing.slice();
  for (const raw of list) {
    if (!raw || typeof raw !== "object") continue;
    const e = raw as HistoryJob;
    if (e.objects == null && e.settings == null) continue;
    if (!e.id) e.id = "h" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    if (ids.has(e.id)) continue;
    jobs.push(e);
    ids.add(e.id);
    added++;
  }
  jobs.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  return { jobs, added };
}
