import type { JobSettings, PlacedPiece, PreparedObject } from "../types";
import { translateLoop } from "./geom";

/** Layout cell of a placed part (full footprint), not the pocket-loop bbox. */
export function footprintOf(placed: PlacedPiece[]): {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  w: number;
  h: number;
} {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const p of placed) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x + p.w > maxX) maxX = p.x + p.w;
    if (p.y + p.h > maxY) maxY = p.y + p.h;
  }
  if (!isFinite(minX)) return { minX: 0, minY: 0, maxX: 0, maxY: 0, w: 0, h: 0 };
  return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
}

export interface PackResult {
  placed: PlacedPiece[];
  usedW: number;
  usedH: number;
  fits: boolean;
}

function packBand(
  prep: PreparedObject,
  count: number,
  availW: number,
  settings: JobSettings,
): { placements: Array<{ x: number; y: number; cx: number; cy: number }>; w: number; h: number } {
  const pitchX = prep.w + settings.spacingX;
  const cols = Math.max(1, Math.floor((availW + settings.spacingX) / pitchX));
  const offset = settings.nest ? (settings.offsetPct / 100) * pitchX : 0;
  const rowPitch = prep.h + settings.spacingY;
  const pts: Array<{ x: number; y: number; cx: number; cy: number }> = [];
  let n = 0,
    row = 0;
  while (n < count && row < 4000) {
    const dx = settings.nest && row % 2 ? offset : 0;
    const maxCols = settings.nest && row % 2 ? Math.max(1, cols - (offset > 0.01 ? 0 : 0)) : cols;
    for (let c = 0; c < maxCols && n < count; c++) {
      const x = dx + c * pitchX;
      if (x + prep.w > availW + 1e-6) break;
      const y = row * rowPitch;
      pts.push({ x, y, cx: x + prep.w / 2, cy: y + prep.h / 2 });
      n++;
    }
    row++;
  }
  let w = 0,
    h = 0;
  for (const p of pts) {
    w = Math.max(w, p.x + prep.w);
    h = Math.max(h, p.y + prep.h);
  }
  return { placements: pts, w, h };
}

export function packObjects(
  objects: PreparedObject[],
  bedW: number,
  bedH: number,
  settings: JobSettings,
): PackResult {
  const mx = settings.marginX;
  const my = settings.marginY;
  const availW = bedW - 2 * mx;
  const bands = objects.map((o) => packBand(o, o.count, Math.max(1, availW), settings));

  let yCursor = 0;
  const placed: PlacedPiece[] = [];

  bands.forEach((band, i) => {
    const o = objects[i];
    if (i > 0) yCursor += settings.objGap;
    band.placements.forEach((p, k) => {
      const x = mx + p.x;
      const y = my + yCursor + p.y;
      placed.push({
        obj: i,
        label: `${o.letter}${k + 1}`,
        color: o.color,
        x,
        y,
        cx: mx + p.cx,
        cy: my + yCursor + p.cy,
        w: o.w,
        h: o.h,
        loops: o.loops.map((l) => translateLoop(l, x, y)),
        holes: o.holes.map((l) => translateLoop(l, x, y)),
        art: (o.artLoops.length ? o.artLoops : o.loops).map((l) => translateLoop(l, x, y)),
        artHoles: o.artHoles.map((l) => translateLoop(l, x, y)),
        hmode: o.holesMode,
        paintSafe: [],
      });
    });
    yCursor += band.h;
  });

  // Center for every footprint. Tight only crops the printed plate; pockets stay on the bed.
  if (settings.center && placed.length) {
    const b = footprintOf(placed);
    const dx = (bedW - b.w) / 2 - b.minX;
    const dy = (bedH - b.h) / 2 - b.minY;
    for (const p of placed) shiftPiece(p, dx, dy);
  }

  const b = placed.length ? footprintOf(placed) : { w: 0, h: 0, minX: 0, minY: 0, maxX: 0, maxY: 0 };
  const fits = b.maxX <= bedW - mx + 1e-4 && b.maxY <= bedH - my + 1e-4 && b.minX >= mx - 1e-4 && b.minY >= my - 1e-4;

  return { placed, usedW: b.w, usedH: b.h, fits };
}

export function shiftPiece(p: PlacedPiece, dx: number, dy: number) {
  p.x += dx;
  p.y += dy;
  p.cx += dx;
  p.cy += dy;
  p.loops = p.loops.map((l) => translateLoop(l, dx, dy));
  p.holes = p.holes.map((l) => translateLoop(l, dx, dy));
  p.art = p.art.map((l) => translateLoop(l, dx, dy));
  p.artHoles = p.artHoles.map((l) => translateLoop(l, dx, dy));
  p.paintSafe = (p.paintSafe || []).map((l) => translateLoop(l, dx, dy));
}

export function applyMoves(placed: PlacedPiece[], moves: Record<string, [number, number]>, bedW: number, bedH: number) {
  for (const p of placed) {
    const m = moves[p.label];
    if (!m) continue;
    let [dx, dy] = m;
    if (p.x + dx < 0) dx = -p.x;
    if (p.x + p.w + dx > bedW) dx = bedW - (p.x + p.w);
    if (p.y + dy < 0) dy = -p.y;
    if (p.y + p.h + dy > bedH) dy = bedH - (p.y + p.h);
    shiftPiece(p, dx, dy);
  }
}
