import { FRAME_PLATE } from "../constants";
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

export function summaryPlateHint(result: JigResult): string | null {
  if (result.frameOn) return `frame ${FRAME_PLATE.w}×${FRAME_PLATE.h}`;
  return null;
}

export function truncateName(name: string, max = 18): string {
  const s = name.trim() || "objeto";
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}
