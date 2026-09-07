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

export interface BedView {
  imgX: number;
  imgY: number;
  imgW: number;
  imgH: number;
  ox: number;
  oy: number;
  scX: number;
  scY: number;
}

/**
 * Fit the **entire** plantilla PNG (pink outline, QR, eufyMake, 0,0, A1)
 * into the canvas, then map the inner blue rectangle to plate mm.
 */
export function fitBedView(
  viewW: number,
  viewH: number,
  plateW: number,
  plateH: number,
  zoom: number,
  panx: number,
  pany: number,
  template: typeof BED_TEMPLATE = BED_TEMPLATE,
): BedView {
  const pad = 20;
  const imgScale0 = Math.min((viewW - pad) / template.imageW, (viewH - pad) / template.imageH);
  const imgScale = Math.max(0.02, imgScale0 * zoom);
  const imgW = template.imageW * imgScale;
  const imgH = template.imageH * imgScale;
  const imgX = (viewW - imgW) / 2 + panx;
  const imgY = (viewH - imgH) / 2 + pany;
  const { inner } = template;
  return {
    imgX,
    imgY,
    imgW,
    imgH,
    ox: imgX + inner.x * imgScale,
    oy: imgY + inner.y * imgScale,
    scX: (inner.w * imgScale) / plateW,
    scY: (inner.h * imgScale) / plateH,
  };
}

/** True STL outline when present; pocket loops otherwise (rect / fallback). */
export function silhouetteLoopsOf(piece: PlacedPiece): Loop[] {
  return piece.art.length ? piece.art : piece.loops;
}
