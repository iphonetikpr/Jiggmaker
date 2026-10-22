import { FIT_CLEARANCE, TEST_STRIP } from "../constants";
import type { FitMaterial, JobObject, Loop, Tri } from "../types";
import { bboxOf, clipLoopToRect, offsetLoop, originLoops, polyArea, rectLoop, translateLoop } from "./geom";
import { meshFromBytes } from "./prepare";
import { clipToDepth, loopsArea, projectStl, silhouetteLoops } from "./project";
import { extrudePlate, solidHeight } from "./mesh";
import { engraveLabel } from "./textEngrave";

export interface StripPocket {
  clearance: number;
  label: string;
  loops: Loop[];
  labelLoops: Loop[];
}

export interface TestStrip {
  mesh: Tri[];
  w: number;
  h: number;
  solidH: number;
  base: number;
  pocketDepth: number;
  margin: number;
  gap: number;
  cropped: boolean;
  clearances: number[];
  labels: string[];
  pockets: StripPocket[];
}

/** `.15` for 0.15, `.20` for 0.2, `.05` for 0.05. */
export function fitLabel(mm: number): string {
  return "." + String(Math.round(mm * 100)).padStart(2, "0");
}

export function fitClearances(material: FitMaterial): number[] {
  return [...FIT_CLEARANCE[material]];
}

export function testStripFilename(name: string, material: FitMaterial): string {
  const safe = name.trim().replace(/[^\w\-]+/g, "_").replace(/^_+|_+$/g, "") || "parte";
  return `${safe}_teststrip_${material}.stl`;
}

function rawShape(obj: JobObject, stl: ArrayBuffer | null, pocketDepth: number): { loops: Loop[]; w: number; h: number } {
  if (stl && obj.stlName && obj.mode === "silhouette") {
    const proj = projectStl(meshFromBytes(stl), obj.up, obj.rot, obj.mirror);
    const full = silhouetteLoops(proj, 0);
    const centered = originLoops(full.length ? full : [rectLoop(Math.max(1, proj.bbox[2] - proj.bbox[0]), Math.max(1, proj.bbox[3] - proj.bbox[1]))]);
    let loops = centered.loops;
    if (pocketDepth > 0 && pocketDepth < proj.partHeight - 0.05 && full.length) {
      const band = clipToDepth(proj, pocketDepth);
      const bandArt = silhouetteLoops(band, 0);
      if (bandArt.length && loopsArea(bandArt) < 0.97 * loopsArea(full)) {
        loops = bandArt.map((l) => translateLoop(l, -centered.ox, -centered.oy));
      }
    }
    return { loops, w: centered.w, h: centered.h };
  }
  const w = Math.max(0.5, obj.rectW);
  const h = Math.max(0.5, obj.rectH);
  return { loops: [rectLoop(w, h)], w, h };
}

function cropCorner(loops: Loop[], w: number, h: number): { loops: Loop[]; cropped: boolean } {
  if (Math.max(w, h) <= TEST_STRIP.cropAbove + 1e-6) return { loops, cropped: false };
  const size = TEST_STRIP.crop;
  const windows: Array<[number, number]> = [
    [0, 0],
    [Math.max(0, w - size), 0],
    [0, Math.max(0, h - size)],
    [Math.max(0, w - size), Math.max(0, h - size)],
  ];
  let best: { x: number; y: number; area: number } | null = null;
  for (const [x, y] of windows) {
    const x1 = Math.min(w, x + size);
    const y1 = Math.min(h, y + size);
    let area = 0;
    for (const loop of loops) area += Math.abs(polyArea(clipLoopToRect(loop, x, y, x1, y1)));
    if (!best || area > best.area + 1e-6 || (Math.abs(area - best.area) <= 1e-6 && (x < best.x - 1e-6 || (Math.abs(x - best.x) <= 1e-6 && y < best.y)))) {
      best = { x, y, area };
    }
  }
  const x = best?.x ?? 0;
  const y = best?.y ?? 0;
  const x1 = Math.min(w, x + size);
  const y1 = Math.min(h, y + size);
  const clipped: Loop[] = [];
  for (const loop of loops) {
    const cut = clipLoopToRect(loop, x, y, x1, y1);
    if (cut.length >= 3) clipped.push(translateLoop(cut, -x, -y));
  }
  if (!clipped.length) clipped.push(rectLoop(x1 - x, y1 - y));
  return { loops: clipped, cropped: true };
}

function grow(loops: Loop[], clearance: number): Loop[] {
  const out: Loop[] = [];
  for (const loop of loops) {
    const next = clearance > 0 ? offsetLoop(loop, clearance) : loop.map((p) => [p[0], p[1]] as [number, number]);
    if (next && next.length >= 3) out.push(next);
  }
  return out.length ? out : loops;
}

/** Three pockets of the first part, 5 mm apart, tight 2 mm margin, base 2 mm. */
export function buildTestStrip(
  obj: JobObject,
  stl: ArrayBuffer | null,
  pocketDepth: number,
  material: FitMaterial,
): TestStrip {
  const raw = rawShape(obj, stl, pocketDepth);
  const cropped = cropCorner(raw.loops, raw.w, raw.h);
  const clearances = fitClearances(material);
  const pockets: StripPocket[] = [];
  let cursor = TEST_STRIP.margin;
  const pocketY = TEST_STRIP.margin + TEST_STRIP.labelHeight + TEST_STRIP.labelGap;
  let maxTop = pocketY;
  for (const clearance of clearances) {
    const shaped = grow(cropped.loops, clearance);
    const box = bboxOf(shaped);
    const dx = cursor - box.minX;
    const dy = pocketY - box.minY;
    const loops = shaped.map((l) => translateLoop(l, dx, dy));
    const moved = bboxOf(loops);
    const label = fitLabel(clearance);
    const glyph = engraveLabel(label, 0, 0, TEST_STRIP.labelHeight);
    const textBox = bboxOf(glyph);
    const cx = (moved.minX + moved.maxX) / 2;
    const labelLoops = glyph.map((l) =>
      translateLoop(l, cx - (textBox.minX + textBox.w / 2), TEST_STRIP.margin - textBox.minY),
    );
    pockets.push({ clearance, label, loops, labelLoops });
    cursor = moved.maxX + TEST_STRIP.gap;
    if (moved.maxY > maxTop) maxTop = moved.maxY;
  }
  const w = cursor - TEST_STRIP.gap + TEST_STRIP.margin;
  const h = maxTop + TEST_STRIP.margin;
  const outer = rectLoop(w, h);
  const mesh = extrudePlate(
    outer,
    [
      ...pockets.map((p) => ({ loops: p.loops })),
      { loops: pockets.flatMap((p) => p.labelLoops), depth: TEST_STRIP.labelDepth },
    ],
    TEST_STRIP.base,
    pocketDepth,
    false,
  );
  return {
    mesh,
    w,
    h,
    solidH: solidHeight(TEST_STRIP.base, pocketDepth),
    base: TEST_STRIP.base,
    pocketDepth,
    margin: TEST_STRIP.margin,
    gap: TEST_STRIP.gap,
    cropped: cropped.cropped,
    clearances,
    labels: pockets.map((p) => p.label),
    pockets,
  };
}
