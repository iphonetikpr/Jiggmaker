import {
  ORIGIN_MARK_DEPTH,
  ORIGIN_MARK_LEG,
  ORIGIN_MARK_WIDTH,
  POCKET_MOUTH_CHAMFER,
  POCKET_MOUTH_CHAMFER_THIN,
  POCKET_MOUTH_THIN_WALL,
} from "../constants";
import type { Loop, Pt } from "../types";
import { pointInPoly } from "./geom";

export interface AxisBox {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

/**
 * 180° rotation about the Y axis through the box center, then a Z shift so the
 * rotated box sits on z = 0. Linear part is diag(-1, 1, -1), determinant +1
 * (a proper rotation, never a mirror).
 */
export function zDownFlipMap(x: number, y: number, z: number, box: AxisBox): [number, number, number] {
  const xr = box.minX + box.maxX - x;
  const zr = box.maxZ - z;
  return [xr, y, zr - box.minZ];
}

function pointSegDist(p: Pt, a: Pt, b: Pt): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  let t = len2 < 1e-16 ? 0 : ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

function segmentsCross(a: Pt, b: Pt, c: Pt, d: Pt): boolean {
  const cross = (p: Pt, q: Pt, r: Pt) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  const d1 = cross(c, d, a);
  const d2 = cross(c, d, b);
  const d3 = cross(a, b, c);
  const d4 = cross(a, b, d);
  return ((d1 > 1e-9 && d2 < -1e-9) || (d1 < -1e-9 && d2 > 1e-9)) && ((d3 > 1e-9 && d4 < -1e-9) || (d3 < -1e-9 && d4 > 1e-9));
}

/** Minimum distance between two closed loops. 0 when the boundaries cross. */
export function loopGap(a: Loop, b: Loop): number {
  let m = Infinity;
  for (let i = 0; i < a.length; i++) {
    const a0 = a[i];
    const a1 = a[(i + 1) % a.length];
    for (let j = 0; j < b.length; j++) {
      const b0 = b[j];
      const b1 = b[(j + 1) % b.length];
      if (segmentsCross(a0, a1, b0, b1)) return 0;
      m = Math.min(m, pointSegDist(a0, b0, b1), pointSegDist(a1, b0, b1), pointSegDist(b0, a0, a1), pointSegDist(b1, a0, a1));
    }
  }
  return m;
}

/**
 * Chamfer size for one pocket mouth. 0.4 mm normally, 0.3 mm when the wall
 * between pockets is thin. Clamped so neighboring mouths and the plate edge
 * are not eaten through. Never adds an elephant-foot XY offset.
 */
export function mouthChamferMm(loop: Loop, neighbors: Loop[], outer: Loop, wallHeight: number): number {
  if (!(wallHeight > 0.2)) return 0;
  let neighbor = Infinity;
  for (const other of neighbors) {
    if (other.length < 3) continue;
    neighbor = Math.min(neighbor, loopGap(loop, other));
  }
  let c = neighbor < POCKET_MOUTH_THIN_WALL ? POCKET_MOUTH_CHAMFER_THIN : POCKET_MOUTH_CHAMFER;
  const edge = outer.length >= 3 ? loopGap(loop, outer) : Infinity;
  if (Number.isFinite(edge)) c = Math.min(c, edge * 0.8);
  // Leave a printable sliver between mouths. A 0.1 mm bridge makes the top cap non-manifold.
  const minBridge = 0.4;
  if (Number.isFinite(neighbor)) c = Math.min(c, Math.max(0, (neighbor - minBridge) / 2));
  c = Math.min(c, wallHeight * 0.45);
  return c >= 0.05 ? c : 0;
}

/** L engraved just inside the origin corner, in plate millimetres (CCW). */
export function originMarkLoop(cornerR: number, shiftX = 0, shiftY = 0): Loop {
  const inset = Math.max(2.2, cornerR + 2);
  const x0 = inset + shiftX;
  const y0 = inset + shiftY;
  const leg = ORIGIN_MARK_LEG;
  const w = ORIGIN_MARK_WIDTH;
  return [
    [x0, y0],
    [x0 + leg, y0],
    [x0 + leg, y0 + w],
    [x0 + w, y0 + w],
    [x0 + w, y0 + leg],
    [x0, y0 + leg],
  ];
}

function loopsInterfere(a: Loop, b: Loop): boolean {
  if (a.some((p) => pointInPoly(p, b))) return true;
  if (b.some((p) => pointInPoly(p, a))) return true;
  for (let i = 0; i < a.length; i++) {
    const a0 = a[i];
    const a1 = a[(i + 1) % a.length];
    for (let j = 0; j < b.length; j++) {
      if (segmentsCross(a0, a1, b[j], b[(j + 1) % b.length])) return true;
    }
  }
  return false;
}

export function originMarkAllowed(mark: Loop, outer: Loop, obstacles: Loop[]): boolean {
  if (mark.length < 3 || outer.length < 3) return false;
  if (!mark.every((p) => pointInPoly(p, outer))) return false;
  for (const o of obstacles) {
    if (o.length >= 3 && loopsInterfere(mark, o)) return false;
  }
  return true;
}

/** Place the origin L on solid plate, clear of pockets. Null if nowhere fits. */
export function fitOriginMark(outer: Loop, obstacles: Loop[], cornerR: number): Loop | null {
  const step = ORIGIN_MARK_LEG + 2;
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 6; col++) {
      const loop = originMarkLoop(cornerR, col * step, row * step);
      if (originMarkAllowed(loop, outer, obstacles)) return loop;
    }
  }
  return null;
}

export { ORIGIN_MARK_DEPTH };
