import { FRAME_PLATE, THIN_BASE_MM, THIN_JIG_SPAN_MM } from "../constants";
import type { JigResult, UpAxis } from "../types";

export const FLIP_UP: Record<UpAxis, UpAxis> = {
  "z+": "z-",
  "z-": "z+",
  "y+": "y-",
  "y-": "y+",
  "x+": "x-",
  "x-": "x+",
};

export function flipUp(up: UpAxis): UpAxis {
  return FLIP_UP[up];
}

/** Bed line in the Summary card, e.g. "Mini · 333 × 88 mm". */
export function summaryBedLine(result: JigResult): string {
  const b = result.bed;
  return `${b.name} · ${b.w} × ${b.h} mm`;
}

export function summaryJigSize(result: JigResult): string {
  return `${result.jig.w.toFixed(0)} × ${result.jig.h.toFixed(0)} mm`;
}

/** Nominal exported plate, before scaleComp. Height is base thickness + pocket depth. */
export function summaryStlSize(result: JigResult): string {
  return `${result.jig.w.toFixed(0)} × ${result.jig.h.toFixed(0)} × ${result.solidH.toFixed(1)} mm`;
}

export const THIN_BASE_WARNING =
  "Jig > 200 mm: recomendamos Base thickness de 3 mm para evitar que se doble o levante las esquinas en PLA";

/** Non-blocking. Uses the exported plate (tight crop or full bed), not the part bbox. */
export function thinBaseWarning(jigW: number, jigH: number, baseThk: number): string | null {
  if (Math.max(jigW, jigH) > THIN_JIG_SPAN_MM && baseThk < THIN_BASE_MM) return THIN_BASE_WARNING;
  return null;
}

export function summaryPlateHint(result: JigResult): string | null {
  if (result.frameOn) return `frame ${FRAME_PLATE.w}×${FRAME_PLATE.h}`;
  return null;
}

export function truncateName(name: string, max = 18): string {
  const s = name.trim() || "objeto";
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}
