import { DEFAULTS, PRESET_KEY } from "../constants";
import type { StringStore } from "../storage/store";
import type { HolesMode, JobObject, JobSettings, PocketMode, UpAxis } from "../types";
import { applyHistorySettings, defaultSettings } from "./history";

/** Per-object parameters that are not part geometry (no STL, no rectangle size). */
export interface ObjectParams {
  up: UpAxis;
  rot: number;
  mirror: boolean;
  auto: boolean;
  mode: PocketMode;
  clear: number;
  holes: HolesMode;
  count: number;
}

export interface NamedPreset {
  id: string;
  name: string;
  readonly?: boolean;
  settings: JobSettings;
  objects: ObjectParams[];
}

export const BUILTIN_DEFAULTS_ID = "builtin-defaults";

const UP_AXES = new Set<UpAxis>(["z+", "z-", "y+", "y-", "x+", "x-"]);
const HOLES = new Set<HolesMode>(["none", "template", "jig", "all"]);

export function defaultObjectParams(): ObjectParams {
  return {
    up: "z+",
    rot: 0,
    mirror: false,
    auto: false,
    mode: "rectangle",
    clear: DEFAULTS.clearance,
    holes: "none",
    count: DEFAULTS.qty,
  };
}

export function defaultsPreset(): NamedPreset {
  return {
    id: BUILTIN_DEFAULTS_ID,
    name: "Defaults",
    readonly: true,
    settings: defaultSettings(),
    objects: [defaultObjectParams()],
  };
}

export function objectParamsOf(obj: JobObject): ObjectParams {
  return {
    up: obj.up,
    rot: obj.rot,
    mirror: obj.mirror,
    auto: obj.auto,
    mode: obj.mode,
    clear: obj.clear,
    holes: obj.holes,
    count: obj.count,
  };
}

export function capturePreset(name: string, settings: JobSettings, objects: JobObject[], id = newPresetId()): NamedPreset {
  return {
    id,
    name: name.trim(),
    settings: applyHistorySettings({ ...settings }),
    objects: objects.map(objectParamsOf),
  };
}

export function applyObjectParams(objects: JobObject[], params: ObjectParams[]): JobObject[] {
  return objects.map((obj, i) => {
    const p = params[i];
    if (!p) return obj;
    return {
      ...obj,
      up: p.up,
      rot: p.rot,
      mirror: p.mirror,
      auto: p.auto,
      mode: p.mode,
      clear: p.clear,
      holes: p.holes,
      count: p.count,
    };
  });
}

export function presetDiffers(preset: NamedPreset, settings: JobSettings, objects: JobObject[]): boolean {
  const base = applyHistorySettings(preset.settings);
  if (!jobSettingsEqual(base, settings)) return true;
  const n = Math.min(objects.length, preset.objects.length);
  for (let i = 0; i < n; i++) {
    if (!objectParamsEqual(objectParamsOf(objects[i]), preset.objects[i])) return true;
  }
  return false;
}

export function listPresets(store: StringStore): NamedPreset[] {
  return [defaultsPreset(), ...loadUserPresets(store)];
}

export function loadUserPresets(store: StringStore): NamedPreset[] {
  try {
    const raw = store.read(PRESET_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as { presets?: unknown };
    if (!parsed || !Array.isArray(parsed.presets)) return [];
    const out: NamedPreset[] = [];
    for (const item of parsed.presets) {
      const preset = normalizePreset(item);
      if (preset && preset.id !== BUILTIN_DEFAULTS_ID) out.push(preset);
    }
    return out;
  } catch {
    return [];
  }
}

export function saveUserPresets(store: StringStore, presets: NamedPreset[]): boolean {
  try {
    const user = presets.filter((p) => !p.readonly && p.id !== BUILTIN_DEFAULTS_ID);
    store.write(PRESET_KEY, JSON.stringify({ version: 1, presets: user }));
    return true;
  } catch {
    return false;
  }
}

function jobSettingsEqual(a: JobSettings, b: JobSettings): boolean {
  const keys = Object.keys(defaultSettings()) as (keyof JobSettings)[];
  return keys.every((k) => a[k] === b[k]);
}

function objectParamsEqual(a: ObjectParams, b: ObjectParams): boolean {
  return (
    a.up === b.up &&
    a.rot === b.rot &&
    a.mirror === b.mirror &&
    a.auto === b.auto &&
    a.mode === b.mode &&
    a.clear === b.clear &&
    a.holes === b.holes &&
    a.count === b.count
  );
}

function newPresetId(): string {
  return "p" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function normalizePreset(raw: unknown): NamedPreset | null {
  if (!raw || typeof raw !== "object") return null;
  const rec = raw as Record<string, unknown>;
  if (typeof rec.id !== "string" || !rec.id) return null;
  if (typeof rec.name !== "string" || !rec.name.trim()) return null;
  if (!rec.settings || typeof rec.settings !== "object" || Array.isArray(rec.settings)) return null;
  const objects = Array.isArray(rec.objects) ? rec.objects.map(normalizeObjectParams).filter((p): p is ObjectParams => !!p) : [];
  return {
    id: rec.id,
    name: rec.name.trim(),
    settings: applyHistorySettings(rec.settings as Record<string, unknown>),
    objects: objects.length ? objects : [defaultObjectParams()],
  };
}

function normalizeObjectParams(raw: unknown): ObjectParams | null {
  if (!raw || typeof raw !== "object") return null;
  const rec = raw as Record<string, unknown>;
  const base = defaultObjectParams();
  const up = typeof rec.up === "string" && UP_AXES.has(rec.up as UpAxis) ? (rec.up as UpAxis) : base.up;
  const holes = typeof rec.holes === "string" && HOLES.has(rec.holes as HolesMode) ? (rec.holes as HolesMode) : base.holes;
  const mode: PocketMode = rec.mode === "silhouette" ? "silhouette" : "rectangle";
  const rot = finiteNumber(rec.rot, base.rot);
  const clear = finiteNumber(rec.clear, base.clear);
  const count = Math.max(1, Math.round(finiteNumber(rec.count, base.count)));
  return {
    up,
    rot,
    mirror: rec.mirror === true || rec.mirror === "true",
    auto: rec.auto === true || rec.auto === "true",
    mode,
    clear,
    holes,
    count,
  };
}

function finiteNumber(value: unknown, fallback: number): number {
  const n = typeof value === "number" ? value : parseFloat(String(value));
  return Number.isFinite(n) ? n : fallback;
}
