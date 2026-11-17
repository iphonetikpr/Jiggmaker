import earcut from "earcut";
import {
  DOWEL_POCKET_WALL,
  SPLIT_DOWEL_DIA,
  SPLIT_HOLE_DIA,
  SPLIT_OVERLAP,
  SPLIT_TAB_INSET,
} from "../constants";
import type { JigResult, Loop, MeshPocket, PlateSplit, Pt, Tri } from "../types";
import {
  bboxOf,
  clipLoopToRect,
  ensureCCW,
  ensureCW,
  mergeCollinear,
  pointInPoly,
  polyArea,
} from "./geom";
import { applyMeshXform, extrudePlate, meshBBox } from "./mesh";

export interface SplitMesh {
  split: PlateSplit;
  mesh: Tri[];
}

export interface DowelSite {
  axis: "x" | "y";
  at: number;
  span: number;
  z: number;
  role: "male" | "female";
}

/** First cut attempt: keep the 2.5 mm pin shaft out of the pocket, then slide the pin in Y. */
const SPLIT_CUT_SHAFT = SPLIT_OVERLAP;
/** Fallback: overlap + 2 mm wall + hole radius, so a pin aligned with the pocket still clears it. */
const SPLIT_CUT_SAFE = SPLIT_OVERLAP + DOWEL_POCKET_WALL + SPLIT_HOLE_DIA / 2;

function axisHitsInterior(loop: Loop, axis: "x" | "y", at: number): boolean {
  const box = bboxOf([loop]);
  const min = axis === "x" ? box.minX : box.minY;
  const max = axis === "x" ? box.maxX : box.maxY;
  if (at <= min + 0.02 || at >= max - 0.02) return false;
  for (let i = 0; i < loop.length; i++) {
    const a = axis === "x" ? loop[i][0] : loop[i][1];
    const b = axis === "x" ? loop[(i + 1) % loop.length][0] : loop[(i + 1) % loop.length][1];
    if ((a < at && b > at) || (b < at && a > at)) return true;
  }
  return false;
}

function cutHitsPocket(loops: Loop[], axis: "x" | "y", at: number, pad: number): boolean {
  const samples = 4;
  for (let i = 0; i <= samples; i++) {
    const s = at - pad + ((2 * pad) * i) / samples;
    if (loops.some((loop) => axisHitsInterior(loop, axis, s))) return true;
  }
  return false;
}

function nearestClearCut(ideal: number, minC: number, maxC: number, blocked: (at: number) => boolean): number | null {
  if (!(maxC >= minC - 1e-6)) return null;
  const lo = minC;
  const hi = maxC;
  const span = Math.max(ideal - lo, hi - ideal, 0);
  for (let d = 0; d <= span + 0.51; d += 0.5) {
    const candidates = d === 0 ? [ideal] : [ideal - d, ideal + d];
    for (const raw of candidates) {
      if (raw < lo - 1e-6 || raw > hi + 1e-6) continue;
      const at = Math.min(hi, Math.max(lo, raw));
      if (!blocked(at)) return at;
    }
  }
  return null;
}

function cutsForAxis(length: number, maxBed: number, axis: "x" | "y", obstacles: Loop[], pad: number): number[] | null {
  if (length <= maxBed + 1e-6) return [0, length];
  const n = Math.max(2, Math.ceil(length / maxBed));
  const cuts = [0];
  for (let i = 1; i < n; i++) {
    const ideal = (length * i) / n;
    const minC = Math.max(cuts[i - 1] + 1, length - (n - i) * maxBed);
    const maxC = Math.min(length - 1, i * maxBed);
    const at = nearestClearCut(ideal, minC, maxC, (c) => cutHitsPocket(obstacles, axis, c, pad));
    if (at == null) return null;
    cuts.push(at);
  }
  cuts.push(length);
  for (let i = 1; i < cuts.length; i++) {
    if (cuts[i] - cuts[i - 1] > maxBed + 1e-4) return null;
  }
  return cuts;
}

export interface SplitPlan {
  splits: PlateSplit[];
  /** Set when a required cut has no free strip that misses every pocket. */
  blocked: string | null;
}

export interface SplitObstacle {
  label: string;
  loops: Loop[];
}

function obstacleLoops(items: SplitObstacle[]): Loop[] {
  return items.flatMap((item) => item.loops);
}

function buildSplits(xs: number[], ys: number[]): PlateSplit[] {
  const nx = xs.length - 1;
  const ny = ys.length - 1;
  if (nx * ny <= 1) return [];
  const splits: PlateSplit[] = [];
  const n = nx * ny;
  let i = 0;
  for (let iy = 0; iy < ny; iy++) {
    for (let ix = 0; ix < nx; ix++) {
      i++;
      splits.push({
        x0: xs[ix],
        x1: xs[ix + 1],
        y0: ys[iy],
        y1: ys[iy + 1],
        ix,
        iy,
        nx,
        ny,
        label: `split${i}of${n}`,
      });
    }
  }
  return splits;
}

function splitsForPad(jigW: number, jigH: number, maxBed: number, loops: Loop[], pad: number): PlateSplit[] | null {
  const xs = cutsForAxis(jigW, maxBed, "x", loops, pad);
  const ys = cutsForAxis(jigH, maxBed, "y", loops, pad);
  if (!xs || !ys) return null;
  return buildSplits(xs, ys);
}

function labelsOnIdealCut(length: number, maxBed: number, axis: "x" | "y", items: SplitObstacle[]): string[] {
  if (length <= maxBed + 1e-6) return [];
  const n = Math.max(2, Math.ceil(length / maxBed));
  const ideals: number[] = [];
  for (let i = 1; i < n; i++) ideals.push((length * i) / n);
  const hit = items.filter((item) => ideals.some((at) => item.loops.some((loop) => axisHitsInterior(loop, axis, at))));
  return hit.map((item) => item.label);
}

function splitBlockedMessage(labels: string[]): string {
  const unique = [...new Set(labels)];
  const shown = unique.slice(0, 6);
  const hueco =
    shown.length <= 1
      ? `el hueco ${shown[0] || "A1"}`
      : `los huecos ${shown.slice(0, -1).join(", ")} y ${shown[shown.length - 1]}${unique.length > shown.length ? " y otras" : ""}`;
  return `No se puede dividir: el corte pasaría por ${hueco} y no hay franja libre. Mueve las piezas o desactiva la división.`;
}

/** Split every axis that exceeds maxPrintBed. Pins slide first; the cut moves only if they cannot. */
export function planPlateSplits(jigW: number, jigH: number, maxBed: number, obstacles: SplitObstacle[] = []): SplitPlan {
  const loops = obstacleLoops(obstacles);
  const needsSplit = jigW > maxBed + 1e-6 || jigH > maxBed + 1e-6;
  const usable = (splits: PlateSplit[] | null) =>
    !!splits && (!needsSplit || splits.length >= 2) && dowelsClearSeams(splits, loops, jigW, jigH);
  const loose = splitsForPad(jigW, jigH, maxBed, loops, SPLIT_CUT_SHAFT);
  if (usable(loose)) return { splits: loose as PlateSplit[], blocked: null };
  const safe = splitsForPad(jigW, jigH, maxBed, loops, SPLIT_CUT_SAFE);
  if (usable(safe)) return { splits: safe as PlateSplit[], blocked: null };
  const labels = [
    ...labelsOnIdealCut(jigW, maxBed, "x", obstacles),
    ...labelsOnIdealCut(jigH, maxBed, "y", obstacles),
  ];
  return { splits: [], blocked: splitBlockedMessage(labels.length ? labels : obstacles.map((item) => item.label)) };
}

function spanWindow(span0: number, span1: number): { a: number; b: number; inset: number; lo: number; hi: number; len: number } {
  const a = Math.min(span0, span1);
  const b = Math.max(span0, span1);
  const len = b - a;
  const r = SPLIT_HOLE_DIA / 2;
  let inset = SPLIT_TAB_INSET;
  if (len < inset * 2 + SPLIT_HOLE_DIA + 4) inset = Math.max(r + 3, (len - SPLIT_HOLE_DIA - 4) / 2);
  return { a, b, inset, lo: a + inset, hi: b - inset, len };
}

export function dowelCenters(span0: number, span1: number): number[] {
  const { a, b, inset, len } = spanWindow(span0, span1);
  const usable = len - 2 * inset;
  if (usable < SPLIT_HOLE_DIA) {
    if (len > SPLIT_HOLE_DIA + 6) return [(a + b) / 2];
    return [];
  }
  let n = 2;
  if (len >= 180) n = 3;
  if (len >= 300) n = 4;
  n = Math.min(n, Math.max(1, Math.floor(usable / (SPLIT_HOLE_DIA + 8))));
  const centers: number[] = [];
  for (let i = 0; i < n; i++) centers.push(a + inset + (usable * (i + 0.5)) / n);
  return centers;
}

function clipPockets(pockets: MeshPocket[], s: PlateSplit): MeshPocket[] {
  const out: MeshPocket[] = [];
  for (const p of pockets) {
    const loops: Loop[] = [];
    const leadIns: number[] = [];
    p.loops.forEach((loop, i) => {
      const cut = clipLoopToRect(loop, s.x0, s.y0, s.x1, s.y1);
      if (cut.length < 3 || Math.abs(polyArea(cut)) <= 0.05) return;
      loops.push(cut);
      leadIns.push(p.leadIns?.[i] ?? p.leadIn ?? 0);
    });
    if (!loops.length) continue;
    const holes = (p.holes || [])
      .map((loop) => clipLoopToRect(loop, s.x0, s.y0, s.x1, s.y1))
      .filter((loop) => loop.length >= 3);
    let pick = p.pick || null;
    if (pick && (pick.cx < s.x0 || pick.cx > s.x1 || pick.cy < s.y0 || pick.cy > s.y1)) pick = null;
    out.push({ loops, holes, pick, depth: p.depth, leadIn: leadIns[0] ?? 0, leadIns });
  }
  return out;
}

function triOnPlane(t: Tri, axis: "x" | "y", at: number, eps = 0.03): boolean {
  const i = axis === "x" ? 0 : 1;
  return Math.abs(t[i] - at) < eps && Math.abs(t[i + 3] - at) < eps && Math.abs(t[i + 6] - at) < eps;
}

function pushTri(
  out: Tri[],
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  cx: number,
  cy: number,
  cz: number,
) {
  const ux = bx - ax,
    uy = by - ay,
    uz = bz - az;
  const vx = cx - ax,
    vy = cy - ay,
    vz = cz - az;
  if (Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) < 1e-12) return;
  out.push([ax, ay, az, bx, by, bz, cx, cy, cz]);
}

function mapFace(axis: "x" | "y", at: number, span: number, z: number): [number, number, number] {
  return axis === "x" ? [at, span, z] : [span, at, z];
}

function addFace(
  out: Tri[],
  axis: "x" | "y",
  at: number,
  outer: Loop,
  holes: Loop[],
  desired: [number, number, number],
) {
  const verts: number[] = [];
  const holeIdx: number[] = [];
  const add = (loop: Loop) => {
    for (const [u, v] of loop) verts.push(u, v);
  };
  add(ensureCCW(outer));
  for (const h of holes) {
    if (h.length < 3) continue;
    holeIdx.push(verts.length / 2);
    add(ensureCW(h));
  }
  const idx = earcut(verts, holeIdx, 2);
  for (let i = 0; i < idx.length; i += 3) {
    const ia = idx[i],
      ib = idx[i + 1],
      ic = idx[i + 2];
    const A = mapFace(axis, at, verts[ia * 2], verts[ia * 2 + 1]);
    const B = mapFace(axis, at, verts[ib * 2], verts[ib * 2 + 1]);
    const C = mapFace(axis, at, verts[ic * 2], verts[ic * 2 + 1]);
    const ux = B[0] - A[0],
      uy = B[1] - A[1],
      uz = B[2] - A[2];
    const vx = C[0] - A[0],
      vy = C[1] - A[1],
      vz = C[2] - A[2];
    const nx = uy * vz - uz * vy,
      ny = uz * vx - ux * vz,
      nz = ux * vy - uy * vx;
    const flip = nx * desired[0] + ny * desired[1] + nz * desired[2] < 0;
    if (flip) pushTri(out, A[0], A[1], A[2], C[0], C[1], C[2], B[0], B[1], B[2]);
    else pushTri(out, A[0], A[1], A[2], B[0], B[1], B[2], C[0], C[1], C[2]);
  }
}

function circle2(u: number, v: number, r: number, n = 20): Loop {
  const pts: Loop = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    pts.push([u + r * Math.cos(a), v + r * Math.sin(a)]);
  }
  return pts;
}

function addTube(
  out: Tri[],
  axis: "x" | "y",
  at: number,
  ring: Loop,
  dir: 1 | -1,
  length: number,
  hole: boolean,
) {
  const segs = ring.length;
  const pt = (i: number, along: number): [number, number, number] => {
    const [u, v] = ring[i];
    return axis === "x" ? [at + dir * along, u, v] : [u, at + dir * along, v];
  };
  for (let i = 0; i < segs; i++) {
    const j = (i + 1) % segs;
    const a0 = pt(i, 0),
      a1 = pt(j, 0),
      b0 = pt(i, length),
      b1 = pt(j, length);
    const invert = hole ? dir === 1 : dir !== 1;
    if (!invert) {
      pushTri(out, a0[0], a0[1], a0[2], a1[0], a1[1], a1[2], b1[0], b1[1], b1[2]);
      pushTri(out, a0[0], a0[1], a0[2], b1[0], b1[1], b1[2], b0[0], b0[1], b0[2]);
    } else {
      pushTri(out, a0[0], a0[1], a0[2], b1[0], b1[1], b1[2], a1[0], a1[1], a1[2]);
      pushTri(out, a0[0], a0[1], a0[2], b0[0], b0[1], b0[2], b1[0], b1[1], b1[2]);
    }
  }
}

type Joint = { axis: "x" | "y"; at: number; role: "male" | "female"; span0: number; span1: number };

function jointsOf(s: PlateSplit, jigW: number, jigH: number): Joint[] {
  const j: Joint[] = [];
  if (s.x0 > 1e-6) j.push({ axis: "x", at: s.x0, role: "female", span0: s.y0, span1: s.y1 });
  if (s.x1 < jigW - 1e-6) j.push({ axis: "x", at: s.x1, role: "male", span0: s.y0, span1: s.y1 });
  if (s.y0 > 1e-6) j.push({ axis: "y", at: s.y0, role: "female", span0: s.x0, span1: s.x1 });
  if (s.y1 < jigH - 1e-6) j.push({ axis: "y", at: s.y1, role: "male", span0: s.x0, span1: s.x1 });
  return j;
}

const DOWEL_MIN_SEP = SPLIT_HOLE_DIA + 8;

function segDist(a: Pt, b: Pt, c: Pt, d: Pt): number {
  const ux = b[0] - a[0],
    uy = b[1] - a[1];
  const vx = d[0] - c[0],
    vy = d[1] - c[1];
  const wx = a[0] - c[0],
    wy = a[1] - c[1];
  const aa = ux * ux + uy * uy;
  const bb = ux * vx + uy * vy;
  const cc = vx * vx + vy * vy;
  const dd = ux * wx + uy * wy;
  const ee = vx * wx + vy * wy;
  const disc = aa * cc - bb * bb;
  let sN: number;
  let sD = disc;
  let tN: number;
  let tD = disc;
  if (disc < 1e-8) {
    sN = 0;
    sD = 1;
    tN = ee;
    tD = cc;
  } else {
    sN = bb * ee - cc * dd;
    tN = aa * ee - bb * dd;
    if (sN < 0) {
      sN = 0;
      tN = ee;
      tD = cc;
    } else if (sN > sD) {
      sN = sD;
      tN = ee + bb;
      tD = cc;
    }
  }
  if (tN < 0) {
    tN = 0;
    if (-dd < 0) sN = 0;
    else if (-dd > aa) sN = sD;
    else {
      sN = -dd;
      sD = aa;
    }
  } else if (tN > tD) {
    tN = tD;
    if (-dd + bb < 0) sN = 0;
    else if (-dd + bb > aa) sN = sD;
    else {
      sN = -dd + bb;
      sD = aa;
    }
  }
  const sc = Math.abs(sN) < 1e-8 ? 0 : sN / sD;
  const tc = Math.abs(tN) < 1e-8 ? 0 : tN / tD;
  return Math.hypot(wx + sc * ux - tc * vx, wy + sc * uy - tc * vy);
}

function holeEnds(axis: "x" | "y", at: number, span: number): [Pt, Pt] {
  if (axis === "x") return [
    [at - SPLIT_OVERLAP, span],
    [at + SPLIT_OVERLAP, span],
  ];
  return [
    [span, at - SPLIT_OVERLAP],
    [span, at + SPLIT_OVERLAP],
  ];
}

function segmentToLoop(a: Pt, b: Pt, loop: Loop): number {
  const mid: Pt = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  if (pointInPoly(a, loop) || pointInPoly(b, loop) || pointInPoly(mid, loop)) return 0;
  let best = Infinity;
  for (let i = 0; i < loop.length; i++) best = Math.min(best, segDist(a, b, loop[i], loop[(i + 1) % loop.length]));
  return best;
}

/** Wall from the Ø3.25 hole (2.5 mm into both halves) to the nearest pocket seat. */
export function dowelPocketClearance(axis: "x" | "y", at: number, span: number, loops: Loop[]): number {
  const [a, b] = holeEnds(axis, at, span);
  let best = Infinity;
  for (const loop of loops) {
    if (loop.length < 3) continue;
    best = Math.min(best, segmentToLoop(a, b, loop) - SPLIT_HOLE_DIA / 2);
  }
  return best;
}

function jointBlocked(j: Joint, span: number, pockets: MeshPocket[]): boolean {
  return dowelPocketClearance(j.axis, j.at, span, pockets.flatMap((p) => p.loops)) < DOWEL_POCKET_WALL - 1e-3;
}

function dowelsClearSeams(splits: PlateSplit[], loops: Loop[], jigW: number, jigH: number): boolean {
  const pockets: MeshPocket[] = loops.map((loop) => ({ loops: [loop] }));
  for (const split of splits) {
    for (const joint of jointsOf(split, jigW, jigH)) {
      const want = dowelCenters(joint.span0, joint.span1).length;
      const got = placeSpansForJoint(joint.span0, joint.span1, (span) => jointBlocked(joint, span, pockets)).length;
      if (got < want) return false;
    }
  }
  return true;
}

/**
 * Prefer the even `dowelCenters` layout. If a site hits a pocket (typical on the
 * plate mid-line Y cut), slide it along the cut into the nearest clear gap so
 * every seam still gets matching pin/hole + overlap.
 */
export function placeSpansForJoint(
  span0: number,
  span1: number,
  blocked: (span: number) => boolean,
): number[] {
  const preferred = dowelCenters(span0, span1);
  if (!preferred.length) return [];
  const { lo, hi } = spanWindow(span0, span1);
  const inWin = (u: number) => u >= lo - 1e-9 && u <= hi + 1e-9;
  const ok = (u: number, occupied: number[]) =>
    inWin(u) && !blocked(u) && occupied.every((o) => Math.abs(o - u) >= DOWEL_MIN_SEP);

  const nearest = (span: number, occupied: number[]): number | null => {
    if (ok(span, occupied)) return span;
    const maxD = Math.max(span - lo, hi - span, 0);
    for (let d = 0.5; d <= maxD + 1e-9; d += 0.5) {
      if (ok(span - d, occupied)) return span - d;
      if (ok(span + d, occupied)) return span + d;
    }
    return null;
  };

  const placed: number[] = [];
  for (const c of preferred) {
    const u = nearest(c, placed);
    if (u != null) placed.push(u);
  }
  if (placed.length < preferred.length) {
    for (let u = lo; u <= hi + 1e-9 && placed.length < preferred.length; u += 0.5) {
      if (ok(u, placed)) placed.push(u);
    }
  }
  return placed.sort((a, b) => a - b);
}

export function dowelSitesFor(s: PlateSplit, result: JigResult): DowelSite[] {
  const z = result.solidH / 2;
  if (result.solidH < SPLIT_DOWEL_DIA + 0.4) return [];
  const sites: DowelSite[] = [];
  for (const j of jointsOf(s, result.jig.w, result.jig.h)) {
    const spans = placeSpansForJoint(j.span0, j.span1, (span) => jointBlocked(j, span, result.meshPockets));
    for (const span of spans) sites.push({ axis: j.axis, at: j.at, span, z, role: j.role });
  }
  return sites;
}

/** Interior cut planes for a split grid (both X and Y when 2×2). */
export function splitSeamMarks(splits: PlateSplit[]): Array<{ axis: "x" | "y"; at: number }> {
  const xs = new Set<number>();
  const ys = new Set<number>();
  for (const s of splits) {
    if (s.nx > 1 && s.ix > 0) xs.add(s.x0);
    if (s.ny > 1 && s.iy > 0) ys.add(s.y0);
  }
  const marks: Array<{ axis: "x" | "y"; at: number }> = [];
  for (const at of [...xs].sort((a, b) => a - b)) marks.push({ axis: "x", at });
  for (const at of [...ys].sort((a, b) => a - b)) marks.push({ axis: "y", at });
  return marks;
}

function attachConnectors(mesh: Tri[], s: PlateSplit, result: JigResult): Tri[] {
  const sites = dowelSitesFor(s, result);
  if (!sites.length) return mesh;
  const byPlane = new Map<string, DowelSite[]>();
  for (const site of sites) {
    const k = `${site.axis}:${site.at.toFixed(4)}`;
    const list = byPlane.get(k) || [];
    list.push(site);
    byPlane.set(k, list);
  }
  let kept = mesh;
  const extra: Tri[] = [];
  for (const group of byPlane.values()) {
    const { axis, at, role } = group[0];
    const r = (role === "male" ? SPLIT_DOWEL_DIA : SPLIT_HOLE_DIA) / 2;
    kept = kept.filter((t) => !triOnPlane(t, axis, at));
    const span0 = axis === "x" ? s.y0 : s.x0;
    const span1 = axis === "x" ? s.y1 : s.x1;
    const outer: Loop = [
      [span0, 0],
      [span1, 0],
      [span1, result.solidH],
      [span0, result.solidH],
    ];
    const holes = group.map((g) => circle2(g.span, g.z, r));
    const outward: [number, number, number] =
      role === "male"
        ? axis === "x"
          ? [1, 0, 0]
          : [0, 1, 0]
        : axis === "x"
          ? [-1, 0, 0]
          : [0, -1, 0];
    addFace(extra, axis, at, outer, holes, outward);
    const farNormal: [number, number, number] =
      role === "male"
        ? axis === "x"
          ? [1, 0, 0]
          : [0, 1, 0]
        : axis === "x"
          ? [-1, 0, 0]
          : [0, -1, 0];
    for (let i = 0; i < group.length; i++) {
      addTube(extra, axis, at, holes[i], 1, SPLIT_OVERLAP, role === "female");
      addFace(extra, axis, at + SPLIT_OVERLAP, holes[i], [], farNormal);
    }
  }
  return kept.concat(extra);
}

export function buildSplitMeshes(result: JigResult): SplitMesh[] {
  if (!result.splits.length) return [];
  return result.splits.map((s) => {
    const clipped = clipLoopToRect(result.plateOuter, s.x0, s.y0, s.x1, s.y1);
    const outer = mergeCollinear(ensureCCW(clipped));
    const pockets = clipPockets(result.meshPockets, s);
    const mesh = extrudePlate(outer, pockets, result.baseThk, result.pocketDepth, false);
    const withPins = attachConnectors(mesh, s, result);
    applyMeshXform(withPins, result.meshXform);
    return { split: s, mesh: withPins };
  });
}

export function splitBBoxOk(mesh: Tri[], maxBed: number, overlap = SPLIT_OVERLAP): boolean {
  const b = meshBBox(mesh);
  return Math.max(b.maxX - b.minX, b.maxY - b.minY) <= maxBed + overlap + 0.05;
}
