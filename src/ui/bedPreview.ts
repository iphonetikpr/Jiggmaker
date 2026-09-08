import { FRAME_PLATE } from "../constants";
import type { JigResult, Loop, PlacedPiece } from "../types";

/** Inner printable rect of jiggenerator.com `#bedSvgMini` / `#bedSvgStd`. */
export type BedTemplate = {
  id: string;
  file: string;
  imageW: number;
  imageH: number;
  inner: { x: number; y: number; w: number; h: number };
};

/** Official jiggenerator markup is dark-on-white; sit it on a white plate so branding is visible. */
export function plantillaMarkup(svg: string): string {
  const body = svg.trim().replace(/^<\?xml[^?]*\?>\s*/i, "");
  if (/id=["']plantilla-bg["']/.test(body)) return body;
  return body.replace(
    /<svg([^>]*)>/i,
    `<svg$1><rect id="plantilla-bg" x="0" y="0" width="100%" height="100%" fill="#ffffff"/>`,
  );
}

export function plantillaHasBranding(svg: string): boolean {
  const paths = svg.match(/<path/g)?.length ?? 0;
  return svg.includes('id="Layer_2"') && svg.includes("9.485-7.478") && paths >= 20;
}

/** Official Mini plantilla (333×88). From jiggenerator `_{"333x88":{el:"bedSvgMini",...}}`. */
export const BED_MINI: BedTemplate = {
  id: "bedSvgMini",
  file: "bed-mini.svg",
  imageW: 1089.552,
  imageH: 323.158,
  inner: { x: 37.889, y: 32.312, w: 935.447, h: 255.118 },
};

/** Official Large/standard plantilla (333×418). */
export const BED_STD: BedTemplate = {
  id: "bedSvgStd",
  file: "bed-std.svg",
  imageW: 1085.983,
  imageH: 1284.553,
  inner: { x: 34.195, y: 33.485, w: 935.698, h: 1218.787 },
};

/** @deprecated use BED_MINI — kept so older tests/imports keep a Mini-shaped default. */
export const BED_TEMPLATE = BED_MINI;

export function templateForResult(result: JigResult | null): BedTemplate {
  if (result?.bed.id === "333x418") return BED_STD;
  return BED_MINI;
}

export function bedTemplateUrl(file: string, base = import.meta.env.BASE_URL || "/"): string {
  const prefix = base.endsWith("/") ? base : `${base}/`;
  return `${prefix}${file}`;
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

/** Draw the plantilla so the inner printable rectangle maps onto the plate rect. */
export function bedImageDest(
  template: BedTemplate,
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

/** Fit the full plantilla (QR + eufyMake rail) then map the inner rect to plate mm. */
export function fitBedView(
  viewW: number,
  viewH: number,
  plateW: number,
  plateH: number,
  zoom: number,
  panx: number,
  pany: number,
  template: BedTemplate = BED_MINI,
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

/** Pocket opening (clearance loops) — same pose as `silhouetteLoopsOf`. */
export function pocketLoopsOf(piece: PlacedPiece): Loop[] {
  return piece.loops.length ? piece.loops : piece.art;
}

/** Plantilla SVG extents in bed millimetres (jiggenerator `A()`). CAD Y-up, origin at inner BL. */
export function bedSvgWorld(
  template: BedTemplate,
  bedW: number,
  bedH: number,
): { x0: number; x1: number; y0: number; y1: number } {
  const sx = bedW / template.inner.w;
  const sy = bedH / template.inner.h;
  return {
    x0: -template.inner.x * sx,
    x1: (template.imageW - template.inner.x) * sx,
    y0: (template.inner.y + template.inner.h - template.imageH) * sy,
    y1: (template.inner.y + template.inner.h) * sy,
  };
}

export interface TemplateView {
  sc: number;
  ox: number;
  oy: number;
  imgX: number;
  imgY: number;
  imgW: number;
  imgH: number;
}

/**
 * Fit the full plantilla + bed in CAD mm with one scale (jiggenerator `O()`).
 * Screen: `x' = ox + x*sc`, `y' = oy + (bedH - y)*sc`.
 */
export function fitTemplateView(
  viewW: number,
  viewH: number,
  bedW: number,
  bedH: number,
  zoom: number,
  panx: number,
  pany: number,
  template: BedTemplate = BED_MINI,
): TemplateView {
  const ext = bedSvgWorld(template, bedW, bedH);
  const minX = Math.min(0, ext.x0);
  const minY = Math.min(0, ext.y0);
  const maxX = Math.max(bedW, ext.x1);
  const maxY = Math.max(bedH, ext.y1);
  const worldW = maxX - minX;
  const worldH = maxY - minY;
  const sc0 = Math.min((viewW - 32) / worldW, (viewH - 32) / worldH);
  const sc = Math.max(0.02, sc0 * Math.max(0.01, zoom));
  const ox = (viewW - worldW * sc) / 2 - minX * sc + panx;
  const oy = (viewH - worldH * sc) / 2 - (bedH - maxY) * sc + pany;
  return {
    sc,
    ox,
    oy,
    imgX: ox + ext.x0 * sc,
    imgY: oy + (bedH - ext.y1) * sc,
    imgW: (ext.x1 - ext.x0) * sc,
    imgH: (ext.y1 - ext.y0) * sc,
  };
}

export function clientToBedMm(
  clientX: number,
  clientY: number,
  canvasLeft: number,
  canvasTop: number,
  view: Pick<TemplateView, "ox" | "oy" | "sc">,
  bedH: number,
): [number, number] {
  return [(clientX - canvasLeft - view.ox) / view.sc, bedH - (clientY - canvasTop - view.oy) / view.sc];
}

export function bedToScreen(
  x: number,
  y: number,
  view: Pick<TemplateView, "ox" | "oy" | "sc">,
  bedH: number,
): [number, number] {
  return [view.ox + x * view.sc, view.oy + (bedH - y) * view.sc];
}
