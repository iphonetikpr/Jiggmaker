import type { JobSettings, PlacedPiece, PreparedObject } from "../types";
import { bboxOf, translateLoop } from "./geom";

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
      });
    });
    yCursor += band.h;
  });

  if (settings.center && settings.footprint !== "tight" && placed.length) {
    const b = bboxOf(placed.flatMap((p) => p.loops));
    const dx = (bedW - b.w) / 2 - b.minX;
    const dy = (bedH - b.h) / 2 - b.minY;
    for (const p of placed) shiftPiece(p, dx, dy);
  }

  const b = placed.length ? bboxOf(placed.flatMap((p) => p.loops)) : { w: 0, h: 0, minX: 0, minY: 0, maxX: 0, maxY: 0 };
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
}

export function applyMoves(placed: PlacedPiece[], moves: Record<string, [number, number]>, bedW: number, bedH: number) {
  for (const p of placed) {
    const m = moves[p.label];
    if (!m) continue;
    let [dx, dy] = m;
    const b = bboxOf(p.loops);
    if (b.minX + dx < 0) dx = -b.minX;
    if (b.maxX + dx > bedW) dx = bedW - b.maxX;
    if (b.minY + dy < 0) dy = -b.minY;
    if (b.maxY + dy > bedH) dy = bedH - b.maxY;
    shiftPiece(p, dx, dy);
  }
}
