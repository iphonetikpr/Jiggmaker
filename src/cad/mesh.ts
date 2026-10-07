import earcut from "earcut";
import { ORIGIN_MARK_DEPTH, POCKET_DEPTH_EXTRA, SCALE_COMP } from "../constants";
import type { Loop, MeshPocket, Tri } from "../types";
import { circleLoop, cleanLoop, ensureCCW, ensureCW, offsetLoop, pointInPoly, polyArea } from "./geom";
import { mouthChamferMm, zDownFlipMap, type AxisBox } from "./zDownFlip";

function flatten(outer: Loop, holes: Loop[]): { vertices: number[]; holeIndices: number[] } {
  const vertices: number[] = [];
  const holeIndices: number[] = [];
  const add = (loop: Loop) => {
    for (const [x, y] of loop) vertices.push(x, y);
  };
  add(ensureCCW(outer));
  for (const h of holes) {
    if (h.length < 3) continue;
    holeIndices.push(vertices.length / 2);
    add(ensureCW(h));
  }
  return { vertices, holeIndices };
}

function triNormal(t: Tri): [number, number, number] {
  const ux = t[3] - t[0],
    uy = t[4] - t[1],
    uz = t[5] - t[2];
  const vx = t[6] - t[0],
    vy = t[7] - t[1],
    vz = t[8] - t[2];
  const nx = uy * vz - uz * vy,
    ny = uz * vx - ux * vz,
    nz = ux * vy - uy * vx;
  const len = Math.hypot(nx, ny, nz) || 1;
  return [nx / len, ny / len, nz / len];
}

function pushTri(out: Tri[], ax: number, ay: number, az: number, bx: number, by: number, bz: number, cx: number, cy: number, cz: number) {
  const t: Tri = [ax, ay, az, bx, by, bz, cx, cy, cz];
  const n = triNormal(t);
  if (n[0] === 0 && n[1] === 0 && n[2] === 0) return;
  out.push(t);
}

function wall(out: Tri[], a: [number, number], b: [number, number], z0: number, z1: number, outward: boolean) {
  if (outward) {
    pushTri(out, a[0], a[1], z0, b[0], b[1], z0, b[0], b[1], z1);
    pushTri(out, a[0], a[1], z0, b[0], b[1], z1, a[0], a[1], z1);
  } else {
    pushTri(out, a[0], a[1], z0, b[0], b[1], z1, b[0], b[1], z0);
    pushTri(out, a[0], a[1], z0, a[0], a[1], z1, b[0], b[1], z1);
  }
}

function ringWalls(out: Tri[], loop: Loop, z0: number, z1: number, ccwMeansOuter: boolean) {
  const ccw = polyArea(loop) >= 0;
  const outer = ccwMeansOuter ? ccw : !ccw;
  for (let i = 0; i < loop.length; i++) {
    const a = loop[i];
    const b = loop[(i + 1) % loop.length];
    wall(out, a, b, z0, z1, outer);
  }
}

function cap(out: Tri[], outer: Loop, holes: Loop[], z: number, up: boolean) {
  const { vertices, holeIndices } = flatten(outer, holes);
  const idx = earcut(vertices, holeIndices, 2);
  for (let i = 0; i < idx.length; i += 3) {
    const a = idx[i],
      b = idx[i + 1],
      c = idx[i + 2];
    const ax = vertices[a * 2],
      ay = vertices[a * 2 + 1];
    const bx = vertices[b * 2],
      by = vertices[b * 2 + 1];
    const cx = vertices[c * 2],
      cy = vertices[c * 2 + 1];
    if (up) pushTri(out, ax, ay, z, bx, by, z, cx, cy, z);
    else pushTri(out, ax, ay, z, cx, cy, z, bx, by, z);
  }
}

export type PocketSpec = MeshPocket;

export function solidHeight(baseThk: number, pocketDepth: number): number {
  return baseThk <= 0 ? Math.max(0.4, pocketDepth) : baseThk + pocketDepth;
}

export function plateMeshXform(outer: Loop, scaleComp: boolean): { cx: number; cy: number; s: number } {
  let cx = 0,
    cy = 0,
    n = 0;
  for (const [x, y] of outer) {
    cx += x;
    cy += y;
    n++;
  }
  return { cx: cx / (n || 1), cy: cy / (n || 1), s: scaleComp ? SCALE_COMP : 1 };
}

export function applyMeshXform(tris: Tri[], xf: { cx: number; cy: number; s: number }): Tri[] {
  if (xf.s === 1) return tris;
  for (const t of tris) {
    for (let i = 0; i < 9; i += 3) {
      t[i] = xf.cx + (t[i] - xf.cx) * xf.s;
      t[i + 1] = xf.cy + (t[i + 1] - xf.cy) * xf.s;
      t[i + 2] *= xf.s;
    }
  }
  return tris;
}

/** Rotate the mesh 180° about Y and seat it so min Z = 0. Mutates `tris`. */
export function flipJigZDown(tris: Tri[]): Tri[] {
  const box = meshBBox(tris);
  const axis: AxisBox = { minX: box.minX, maxX: box.maxX, minZ: box.minZ, maxZ: box.maxZ };
  for (const t of tris) {
    for (let i = 0; i < 9; i += 3) {
      const [x, y, z] = zDownFlipMap(t[i], t[i + 1], t[i + 2], axis);
      t[i] = x;
      t[i + 1] = y;
      t[i + 2] = z;
    }
  }
  return tris;
}

export function meshBBox(tris: Tri[]): { minX: number; minY: number; minZ: number; maxX: number; maxY: number; maxZ: number } {
  let minX = Infinity,
    minY = Infinity,
    minZ = Infinity,
    maxX = -Infinity,
    maxY = -Infinity,
    maxZ = -Infinity;
  for (const t of tris) {
    for (let i = 0; i < 9; i += 3) {
      const x = t[i],
        y = t[i + 1],
        z = t[i + 2];
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (z < minZ) minZ = z;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
      if (z > maxZ) maxZ = z;
    }
  }
  if (!isFinite(minX)) return { minX: 0, minY: 0, minZ: 0, maxX: 0, maxY: 0, maxZ: 0 };
  return { minX, minY, minZ, maxX, maxY, maxZ };
}

/** Count edges not shared by exactly two triangles (0 ⇒ closed 2-manifold). */
export function meshNonManifoldEdges(tris: Tri[]): number {
  const uses = new Map<string, number>();
  const q = (n: number) => Math.round(n * 1e5) / 1e5;
  const vk = (x: number, y: number, z: number) => `${q(x)},${q(y)},${q(z)}`;
  const ek = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  for (const t of tris) {
    const vs = [vk(t[0], t[1], t[2]), vk(t[3], t[4], t[5]), vk(t[6], t[7], t[8])];
    if (vs[0] === vs[1] || vs[1] === vs[2] || vs[2] === vs[0]) continue;
    for (let i = 0; i < 3; i++) {
      const k = ek(vs[i], vs[(i + 1) % 3]);
      uses.set(k, (uses.get(k) || 0) + 1);
    }
  }
  let bad = 0;
  for (const c of uses.values()) if (c !== 2) bad++;
  return bad;
}

export interface PlateMeshOptions {
  /** 45° chamfer on the pocket mouth (the edge that sits on the bed after Z-down flip). */
  mouthChamfer?: boolean;
  /** Engraved origin L on the bottom face, so the flip leaves it on top. */
  originMark?: Loop | null;
}

interface MouthWall {
  nominal: Loop;
  top: Loop;
  c: number;
}

function loopInside(outer: Loop, loop: Loop): boolean {
  return loop.every((p) => pointInPoly(p, outer));
}

/** Sloped band from a nominal loop up to a larger mouth. Normals point into the pocket. */
function chamferBand(out: Tri[], nominal: Loop, zNominal: number, mouth: Loop, zMouth: number) {
  const n = Math.min(nominal.length, mouth.length);
  for (let i = 0; i < n; i++) {
    const a0 = nominal[i];
    const a1 = nominal[(i + 1) % n];
    const b0 = mouth[i];
    const b1 = mouth[(i + 1) % n];
    pushTri(out, a0[0], a0[1], zNominal, b1[0], b1[1], zMouth, a1[0], a1[1], zNominal);
    pushTri(out, a0[0], a0[1], zNominal, b0[0], b0[1], zMouth, b1[0], b1[1], zMouth);
  }
}

function resolveMouth(loop: Loop, neighbors: Loop[], outer: Loop, wallH: number, chamferOn: boolean): MouthWall {
  if (!chamferOn) return { nominal: loop, top: loop, c: 0 };
  const nominal = ensureCCW(cleanLoop(loop, 1e-9));
  let c = mouthChamferMm(nominal, neighbors, outer, wallH);
  if (!(c > 0)) return { nominal, top: nominal, c: 0 };
  const grown = offsetLoop(nominal, c);
  if (!grown || grown.length !== nominal.length || !loopInside(outer, grown)) {
    return { nominal, top: nominal, c: 0 };
  }
  return { nominal, top: grown, c };
}

export function extrudePlate(
  outer: Loop,
  pockets: PocketSpec[],
  baseThk: number,
  pocketDepth: number,
  scaleComp: boolean,
  options?: PlateMeshOptions,
): Tri[] {
  const through = baseThk <= 0;
  const extra = through ? 0 : POCKET_DEPTH_EXTRA;
  const topZ = solidHeight(baseThk, pocketDepth);
  const floorZ = through ? 0 : Math.max(0, baseThk - extra);
  const chamferOn = !!options?.mouthChamfer;
  const wallH = topZ - (through ? 0 : floorZ);

  const rawLoops: Loop[] = [];
  for (const p of pockets) {
    for (const loop of p.loops) {
      if (loop.length >= 3) rawLoops.push(loop);
    }
  }
  const neighborsOf = new Map<Loop, Loop[]>();
  if (chamferOn) {
    const nominals = rawLoops.map((loop) => ensureCCW(cleanLoop(loop, 1e-9)));
    for (let i = 0; i < nominals.length; i++) {
      neighborsOf.set(rawLoops[i], nominals.filter((_, j) => j !== i));
    }
  }

  const topHoles: Loop[] = [];
  const mouths: MouthWall[] = [];
  const pickHoles: Loop[] = [];
  // Earcut drops vertices when two holes share a perfectly colinear edge, which
  // opens the cap. A 0.001 mm stagger (far below print tolerance) breaks that.
  let holeIndex = 0;
  for (const p of pockets) {
    for (const loop of p.loops) {
      if (loop.length < 3) continue;
      const stagger = chamferOn ? holeIndex * 0.001 : 0;
      holeIndex++;
      const placed = stagger
        ? loop.map(([x, y]) => [x + stagger, y + stagger] as [number, number])
        : loop;
      const mouth = resolveMouth(placed, neighborsOf.get(loop) || [], outer, wallH, chamferOn);
      topHoles.push(mouth.top);
      mouths.push(mouth);
    }
    if (p.pick && p.pick.r > 0.2) pickHoles.push(circleLoop(p.pick.cx, p.pick.cy, p.pick.r, 20));
  }

  const mark = options?.originMark && options.originMark.length >= 3 ? options.originMark : null;
  const markDepth = mark ? Math.min(ORIGIN_MARK_DEPTH, topZ * 0.45) : 0;
  const useMark = !!mark && markDepth >= 0.3 && loopInside(outer, mark);

  const out: Tri[] = [];
  // Always cut pocket openings in the top — a solid lid z-fights and hides
  // pockets when the 3D preview orbits (painter's algorithm + backfaces).
  cap(out, outer, topHoles, topZ, true);
  const bottomHoles = through ? mouths.map((m) => m.nominal) : pickHoles.slice();
  if (useMark && mark) bottomHoles.push(mark);
  cap(out, outer, bottomHoles, 0, false);
  ringWalls(out, outer, 0, topZ, true);

  let mi = 0;
  for (const p of pockets) {
    const picks = p.pick && p.pick.r > 0.2 ? [circleLoop(p.pick.cx, p.pick.cy, p.pick.r, 20)] : [];
    for (const pocket of p.loops) {
      if (!pocket || pocket.length < 3) continue;
      const mouth = mouths[mi++];
      const zChamfer = topZ - mouth.c;
      if (through) {
        ringWalls(out, mouth.nominal, 0, mouth.c > 0 ? zChamfer : topZ, false);
      } else {
        cap(out, mouth.nominal, picks, floorZ, true);
        ringWalls(out, mouth.nominal, floorZ, mouth.c > 0 ? zChamfer : topZ, false);
      }
      if (mouth.c > 0) chamferBand(out, mouth.nominal, zChamfer, mouth.top, topZ);
    }
    if (!through) {
      for (const hole of picks) {
        ringWalls(out, hole, 0, floorZ, false);
      }
    }
  }

  if (useMark && mark) {
    cap(out, mark, [], markDepth, false);
    ringWalls(out, mark, 0, markDepth, false);
  }

  const xf = plateMeshXform(outer, scaleComp);
  applyMeshXform(out, xf);
  return out;
}

export function toBinarySTL(tris: Tri[]): ArrayBuffer {
  const buf = new ArrayBuffer(84 + 50 * tris.length);
  const view = new DataView(buf);
  const header = "Jiggmaker eufyMake E1";
  for (let i = 0; i < header.length && i < 80; i++) view.setUint8(i, header.charCodeAt(i));
  view.setUint32(80, tris.length, true);
  let o = 84;
  for (const t of tris) {
    const n = triNormal(t);
    view.setFloat32(o, n[0], true);
    view.setFloat32(o + 4, n[1], true);
    view.setFloat32(o + 8, n[2], true);
    o += 12;
    for (let i = 0; i < 9; i++, o += 4) view.setFloat32(o, t[i], true);
    view.setUint16(o, 0, true);
    o += 2;
  }
  return buf;
}

export function toAsciiSTL(tris: Tri[], name: string): string {
  const safe = name.replace(/[^\w.\-]+/g, "_") || "jig";
  let s = `solid ${safe}\n`;
  for (const t of tris) {
    const n = triNormal(t);
    s += `  facet normal ${n[0]} ${n[1]} ${n[2]}\n    outer loop\n`;
    s += `      vertex ${t[0]} ${t[1]} ${t[2]}\n`;
    s += `      vertex ${t[3]} ${t[4]} ${t[5]}\n`;
    s += `      vertex ${t[6]} ${t[7]} ${t[8]}\n`;
    s += `    endloop\n  endfacet\n`;
  }
  s += `endsolid ${safe}\n`;
  return s;
}
