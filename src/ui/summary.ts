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

/** Up to `digits` decimals, without trailing zeros. 1.5 stays 1.5; 30 stays 30. */
export function formatMm(n: number, digits = 2): string {
  if (!Number.isFinite(n)) return "0";
  const factor = 10 ** digits;
  const rounded = Math.round(n * factor) / factor;
  return String(rounded);
}

/** Bed line in the Summary card, e.g. "Mini · 333 × 88 mm". */
export function summaryBedLine(result: JigResult): string {
  const b = result.bed;
  return `${b.name} · ${b.w} × ${b.h} mm`;
}

export function summaryJigSize(result: JigResult): string {
  return `${formatMm(result.jig.w)} × ${formatMm(result.jig.h)} mm`;
}

/** Plate size before scaleComp. Height is base thickness + pocket depth. */
export function summaryStlNominal(result: JigResult): string {
  return `${formatMm(result.jig.w)} × ${formatMm(result.jig.h)} × ${formatMm(result.solidH)} mm`;
}

/** Same plate after the intentional ×1.003 scale. Null when scaleComp is off. */
export function summaryStlCompensated(result: JigResult): string | null {
  const scale = result.meshXform?.s ?? 1;
  if (Math.abs(scale - 1) < 1e-9) return null;
  return `${formatMm(result.jig.w * scale, 3)} × ${formatMm(result.jig.h * scale, 3)} × ${formatMm(result.solidH * scale, 3)} mm`;
}

/** Nominal exported plate, before scaleComp. */
export function summaryStlSize(result: JigResult): string {
  return summaryStlNominal(result);
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
