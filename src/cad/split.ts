import earcut from "earcut";
import {
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

function cutsForAxis(length: number, maxBed: number): number[] {
  if (length <= maxBed + 1e-6) return [0, length];
  const n = Math.max(2, Math.ceil(length / maxBed));
  const out = [0];
  for (let i = 1; i < n; i++) out.push((length * i) / n);
  out.push(length);
  return out;
}

/** Split every axis that exceeds maxPrintBed so each piece fits the FDM cube. */
export function planPlateSplits(jigW: number, jigH: number, maxBed: number): PlateSplit[] {
  const xs = cutsForAxis(jigW, maxBed);
  const ys = cutsForAxis(jigH, maxBed);
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

export function dowelCenters(span0: number, span1: number): number[] {
  const a = Math.min(span0, span1);
  const b = Math.max(span0, span1);
  const len = b - a;
  const r = SPLIT_HOLE_DIA / 2;
  let inset = SPLIT_TAB_INSET;
  if (len < inset * 2 + SPLIT_HOLE_DIA + 4) inset = Math.max(r + 3, (len - SPLIT_HOLE_DIA - 4) / 2);
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

function pocketContains(pockets: MeshPocket[], x: number, y: number, pad: number): boolean {
  for (const p of pockets) {
    for (const loop of p.loops) {
      if (loop.length < 3) continue;
      if (pointInPoly([x, y], loop)) return true;
      if (pad > 0) {
        const b = bboxOf([loop]);
        if (x < b.minX - pad || x > b.maxX + pad || y < b.minY - pad || y > b.maxY + pad) continue;
        for (const [px, py] of loop) {
          if (Math.hypot(px - x, py - y) <= pad) return true;
        }
      }
    }
  }
  return false;
}

function clipPockets(pockets: MeshPocket[], s: PlateSplit): MeshPocket[] {
  const out: MeshPocket[] = [];
  for (const p of pockets) {
    const loops = p.loops
      .map((loop) => clipLoopToRect(loop, s.x0, s.y0, s.x1, s.y1))
      .filter((loop) => loop.length >= 3 && Math.abs(polyArea(loop)) > 0.05);
    if (!loops.length) continue;
    const holes = (p.holes || [])
      .map((loop) => clipLoopToRect(loop, s.x0, s.y0, s.x1, s.y1))
      .filter((loop) => loop.length >= 3);
    let pick = p.pick || null;
    if (pick && (pick.cx < s.x0 || pick.cx > s.x1 || pick.cy < s.y0 || pick.cy > s.y1)) pick = null;
    out.push({ loops, holes, pick });
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
    add(h);
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
  span: number,
  z: number,
  dir: 1 | -1,
  length: number,
  r: number,
  segs = 20,
) {
  const pt = (i: number, along: number): [number, number, number] => {
    const a = (i / segs) * Math.PI * 2;
    const cu = Math.cos(a) * r,
      sv = Math.sin(a) * r;
    return axis === "x" ? [at + dir * along, span + cu, z + sv] : [span + cu, at + dir * along, z + sv];
  };
  for (let i = 0; i < segs; i++) {
    const j = (i + 1) % segs;
    const a0 = pt(i, 0),
      a1 = pt(j, 0),
      b0 = pt(i, length),
      b1 = pt(j, length);
    if (dir === 1) {
      pushTri(out, a0[0], a0[1], a0[2], a1[0], a1[1], a1[2], b1[0], b1[1], b1[2]);
      pushTri(out, a0[0], a0[1], a0[2], b1[0], b1[1], b1[2], b0[0], b0[1], b0[2]);
    } else {
      pushTri(out, a0[0], a0[1], a0[2], b1[0], b1[1], b1[2], a1[0], a1[1], a1[2]);
      pushTri(out, a0[0], a0[1], a0[2], b0[0], b0[1], b0[2], b1[0], b1[1], b1[2]);
    }
  }
}

function jointsOf(
  s: PlateSplit,
  jigW: number,
  jigH: number,
): Array<{ axis: "x" | "y"; at: number; role: "male" | "female"; span0: number; span1: number }> {
  const j: Array<{ axis: "x" | "y"; at: number; role: "male" | "female"; span0: number; span1: number }> = [];
  if (s.x0 > 1e-6) j.push({ axis: "x", at: s.x0, role: "female", span0: s.y0, span1: s.y1 });
  if (s.x1 < jigW - 1e-6) j.push({ axis: "x", at: s.x1, role: "male", span0: s.y0, span1: s.y1 });
  if (s.y0 > 1e-6) j.push({ axis: "y", at: s.y0, role: "female", span0: s.x0, span1: s.x1 });
  if (s.y1 < jigH - 1e-6) j.push({ axis: "y", at: s.y1, role: "male", span0: s.x0, span1: s.x1 });
  return j;
}

export function dowelSitesFor(s: PlateSplit, result: JigResult): DowelSite[] {
  const z = result.solidH / 2;
  if (result.solidH < SPLIT_DOWEL_DIA + 0.4) return [];
  const sites: DowelSite[] = [];
  const rClear = SPLIT_HOLE_DIA / 2 + 0.6;
  for (const j of jointsOf(s, result.jig.w, result.jig.h)) {
    for (const span of dowelCenters(j.span0, j.span1)) {
      const xy: Pt = j.axis === "x" ? [j.at, span] : [span, j.at];
      if (pocketContains(result.meshPockets, xy[0], xy[1], rClear)) continue;
      sites.push({ axis: j.axis, at: j.at, span, z, role: j.role });
    }
  }
  return sites;
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
    for (const g of group) {
      addTube(extra, axis, at, g.span, g.z, 1, SPLIT_OVERLAP, r);
      addFace(
        extra,
        axis,
        at + SPLIT_OVERLAP,
        circle2(g.span, g.z, r),
        [],
        axis === "x" ? [1, 0, 0] : [0, 1, 0],
      );
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
