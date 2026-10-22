import { FINGER_NOTCH_DIA, FINGER_NOTCH_MIN_WALL } from "../constants";
import type { Loop, PlacedPiece, Pt } from "../types";
import { bboxOf, pointInPoly, pointSegDistance, polyArea } from "./geom";

const RADIUS = FINGER_NOTCH_DIA / 2;

export type NotchSide = "minX" | "maxX" | "minY" | "maxY";

export interface NotchBuild {
  loop: Loop;
  /** Semicircle samples, including the diameter endpoints. */
  arc: Loop;
}

function near(a: number, b: number, eps = 0.25): boolean {
  return Math.abs(a - b) < eps;
}

function lerp(a: Pt, b: Pt, t: number): Pt {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

/** Arc from `from` to `to` passing through `via`. */
function arcThrough(center: Pt, from: Pt, to: Pt, via: Pt, n = 18): Loop {
  const ang = (p: Pt) => Math.atan2(p[1] - center[1], p[0] - center[0]);
  const a0 = ang(from);
  const a1 = ang(to);
  const viaA = ang(via);
  const wrap = (a: number) => {
    let x = a;
    while (x < 0) x += Math.PI * 2;
    while (x >= Math.PI * 2) x -= Math.PI * 2;
    return x;
  };
  const ccw = wrap(a1 - a0);
  const viaOff = wrap(viaA - a0);
  const sweep = viaOff <= ccw + 1e-4 ? ccw : ccw - Math.PI * 2;
  const pts: Loop = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + (sweep * i) / n;
    pts.push([center[0] + RADIUS * Math.cos(a), center[1] + RADIUS * Math.sin(a)]);
  }
  return pts;
}

/**
 * Semicircle Ø14 centered on one side of the pocket.
 * The diameter lies on that side; the arc bulges outward.
 */
export function notchOnSide(loop: Loop, side: NotchSide): NotchBuild | null {
  if (loop.length < 3) return null;
  const box = bboxOf([loop]);
  const horizontal = side === "minY" || side === "maxY";
  const coord = side === "minX" ? box.minX : side === "maxX" ? box.maxX : side === "minY" ? box.minY : box.maxY;
  let best: { i: number; length: number } | null = null;
  for (let i = 0; i < loop.length; i++) {
    const a = loop[i];
    const b = loop[(i + 1) % loop.length];
    const on = horizontal ? near(a[1], coord) && near(b[1], coord) : near(a[0], coord) && near(b[0], coord);
    if (!on) continue;
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (!best || length > best.length) best = { i, length };
  }
  if (!best || best.length < FINGER_NOTCH_DIA - 1e-6) return null;
  const i = best.i;
  const a = loop[i];
  const b = loop[(i + 1) % loop.length];
  const len = best.length;
  const half = RADIUS / len;
  const d1 = lerp(a, b, 0.5 - half);
  const d2 = lerp(a, b, 0.5 + half);
  const dx = d2[0] - d1[0];
  const dy = d2[1] - d1[1];
  const ox = dy / len;
  const oy = -dx / len;
  const center: Pt = [(d1[0] + d2[0]) / 2, (d1[1] + d2[1]) / 2];
  const via: Pt = [center[0] + ox * RADIUS, center[1] + oy * RADIUS];
  const arc = arcThrough(center, d1, d2, via);
  const next: Loop = [];
  const same = (p: Pt, q: Pt) => Math.hypot(p[0] - q[0], p[1] - q[1]) < 1e-4;
  for (let k = 0; k < loop.length; k++) {
    next.push(loop[k]);
    if (k !== i) continue;
    for (const p of arc) {
      if (same(p, a) || same(p, b)) continue;
      next.push(p);
    }
  }
  return { loop: next, arc };
}

function loopWall(arc: Loop, others: Loop[]): number {
  const samples = arc.slice(1, -1);
  if (!samples.length) return Infinity;
  let min = Infinity;
  for (const p of samples) {
    for (const loop of others) {
      if (loop.length >= 3 && pointInPoly(p, loop)) return 0;
      for (let i = 0; i < loop.length; i++) {
        const d = pointSegDistance(p, loop[i], loop[(i + 1) % loop.length]);
        if (d < min) min = d;
      }
    }
  }
  return min;
}

function largestLoop(loops: Loop[]): Loop | null {
  let best: Loop | null = null;
  let area = 0;
  for (const loop of loops) {
    const a = Math.abs(polyArea(loop));
    if (a > area) {
      area = a;
      best = loop;
    }
  }
  return best;
}

function arcInsideBed(arc: Loop, bounds: { w: number; h: number }): boolean {
  const box = bboxOf([arc]);
  return box.minX >= -1e-4 && box.minY >= -1e-4 && box.maxX <= bounds.w + 1e-4 && box.maxY <= bounds.h + 1e-4;
}

/**
 * Adds a finger notch on the longest side that still leaves 1.5 mm of wall
 * and stays inside the bed. The other long side is used when the first would
 * break a neighbor or leave the plate. If neither works, the notch is skipped.
 */
export function applyFingerNotches(
  placed: PlacedPiece[],
  enabled: boolean[],
  bounds: { w: number; h: number } = { w: Infinity, h: Infinity },
): string[] {
  const warnings: string[] = [];
  const solids = placed.map((p) => p.loops.map((l) => l.map((pt) => [pt[0], pt[1]] as Pt)));
  for (let pi = 0; pi < placed.length; pi++) {
    const piece = placed[pi];
    if (!enabled[piece.obj]) continue;
    const loop = largestLoop(piece.loops);
    if (!loop) continue;
    const box = bboxOf([loop]);
    const sides: NotchSide[] = box.w >= box.h ? ["minY", "maxY"] : ["minX", "maxX"];
    const others = solids.flatMap((loops, i) => (i === pi ? [] : loops));
    let best: { built: NotchBuild; wall: number; inside: boolean } | null = null;
    let tooShort = true;
    for (const side of sides) {
      const built = notchOnSide(loop, side);
      if (!built) continue;
      tooShort = false;
      const wall = others.length ? loopWall(built.arc, others) : Infinity;
      const inside = arcInsideBed(built.arc, bounds);
      const better =
        !best ||
        (inside && !best.inside) ||
        (inside === best.inside && wall > best.wall);
      if (better) best = { built, wall, inside };
    }
    if (!best) {
      if (tooShort) {
        warnings.push(
          `${piece.label}: finger notch omitido (el lado más largo mide menos de ${FINGER_NOTCH_DIA} mm).`,
        );
      }
      continue;
    }
    if (!best.inside) {
      warnings.push(`${piece.label}: finger notch omitido (el semicírculo sale de la cama).`);
      continue;
    }
    if (best.wall < FINGER_NOTCH_MIN_WALL) {
      warnings.push(
        `${piece.label}: finger notch omitido (pared ${best.wall.toFixed(1)} mm < ${FINGER_NOTCH_MIN_WALL} mm).`,
      );
      continue;
    }
    piece.loops = piece.loops.map((l) => (l === loop ? best!.built.loop : l));
    solids[pi] = piece.loops.map((l) => l.map((pt) => [pt[0], pt[1]] as Pt));
  }
  return warnings;
}
