import { DEFAULTS } from "../constants";
import type { JobObject, JobSettings } from "../types";
import { clampNumber } from "../ui/numberField";

/** Same reading as NumberField: comma or dot, blank and junk are not numbers. */
export function finiteNumber(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const n = Number(value.trim().replace(",", "."));
    if (Number.isFinite(n)) return n;
  }
  return fallback;
}

export function clampField(value: unknown, fallback: number, min: number, max?: number): number {
  return clampNumber(finiteNumber(value, fallback), min, max);
}

/** Bounds match the NumberField min/max on Setup and each object card. */
const SETTING_LIMITS: Partial<Record<keyof JobSettings, { min: number; max?: number }>> = {
  bedW: { min: 10 },
  bedH: { min: 10 },
  spacingX: { min: 0 },
  spacingY: { min: 0 },
  marginX: { min: 0 },
  marginY: { min: 0 },
  objGap: { min: 0 },
  offsetPct: { min: 0, max: 100 },
  matThk: { min: 0.5 },
  pickDia: { min: 2 },
  baseThk: { min: 0 },
  pocketDepth: { min: 0.5 },
  dpi: { min: 72 },
  maxPrintBed: { min: 100 },
  paintSafeInset: { min: 0 },
  paintSafeW: { min: 0.5 },
  paintSafeH: { min: 0.5 },
};

export function normalizeSettings(settings: JobSettings): JobSettings {
  const next = { ...settings };
  for (const [key, limit] of Object.entries(SETTING_LIMITS) as Array<[keyof JobSettings, { min: number; max?: number }]>) {
    const current = next[key];
    if (typeof current !== "number" && typeof current !== "string") continue;
    const fallback = typeof current === "number" && Number.isFinite(current) ? current : limit.min;
    (next as unknown as Record<string, number>)[key] = clampField(current, fallback, limit.min, limit.max);
  }
  return next;
}

/** Width, height, quantity, and clearance use the same floors as the object card. */
export function normalizeObject(obj: JobObject): JobObject {
  return {
    ...obj,
    count: Math.round(clampField(obj.count, DEFAULTS.qty, 1)),
    rectW: clampField(obj.rectW, DEFAULTS.rectW, 1),
    rectH: clampField(obj.rectH, DEFAULTS.rectH, 1),
    clear: clampField(obj.clear, DEFAULTS.clearance, 0, 3),
    rot: finiteNumber(obj.rot, 0),
  };
}
