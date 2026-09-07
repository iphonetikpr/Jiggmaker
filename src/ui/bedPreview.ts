import { FRAME_PLATE } from "../constants";
import type { JigResult, Loop, PlacedPiece } from "../types";

/**
 * `public/bed-template.png` — inner blue rectangle is the printable coordinate
 * system. Pixel bounds match scripts/make-bed-template.py (8 px per Mini-mm).
 */
export const BED_TEMPLATE = {
  file: "bed-template.png",
  imageW: 3048,
  imageH: 896,
  inner: { x: 96, y: 96, w: 2664, h: 704 },
} as const;

export function bedTemplateUrl(base = import.meta.env.BASE_URL || "/"): string {
  const prefix = base.endsWith("/") ? base : `${base}/`;
  return `${prefix}${BED_TEMPLATE.file}`;
}

/** Canvas size of the current plate: Mini 333×88, Frame ON 334×90, Large/custom bed. */
export function plateViewSize(result: JigResult): { w: number; h: number } {
  if (result.frameOn) return { w: FRAME_PLATE.w, h: FRAME_PLATE.h };
  return { w: result.bed.w, h: result.bed.h };
}

/** Mini (333×88) printable coords → Frame plate (334×90), centered. */
export function previewPlateOffset(result: JigResult): { x: number; y: number } {
  if (!result.frameOn) return { x: 0, y: 0 };
  return {
    x: (FRAME_PLATE.w - result.bed.w) / 2,
    y: (FRAME_PLATE.h - result.bed.h) / 2,
  };
}

export function bedToPlate(result: JigResult, x: number, y: number): [number, number] {
  const o = previewPlateOffset(result);
  return [x + o.x, y + o.y];
}

export function plateToBed(result: JigResult, x: number, y: number): [number, number] {
  const o = previewPlateOffset(result);
  return [x - o.x, y - o.y];
}

/** Draw the bed PNG so the inner blue rectangle maps onto the plate rect. */
export function bedImageDest(
  template: typeof BED_TEMPLATE,
  ox: number,
  oy: number,
  plateW: number,
  plateH: number,
  sc: number,
): { x: number; y: number; w: number; h: number } {
  const { imageW, imageH, inner } = template;
  const sx = (plateW * sc) / inner.w;
  const sy = (plateH * sc) / inner.h;
  return {
    x: ox - inner.x * sx,
    y: oy - inner.y * sy,
    w: imageW * sx,
    h: imageH * sy,
  };
}

/** True STL outline when present; pocket loops otherwise (rect / fallback). */
export function silhouetteLoopsOf(piece: PlacedPiece): Loop[] {
  return piece.art.length ? piece.art : piece.loops;
}
