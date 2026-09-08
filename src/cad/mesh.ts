import earcut from "earcut";
import { POCKET_DEPTH_EXTRA, SCALE_COMP } from "../constants";
import type { Loop, Tri } from "../types";
import { circleLoop, ensureCCW, ensureCW, polyArea } from "./geom";

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

export interface PocketSpec {
  loops: Loop[];
  holes?: Loop[];
  pick?: { cx: number; cy: number; r: number } | null;
}

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

export function extrudePlate(
  outer: Loop,
  pockets: PocketSpec[],
  baseThk: number,
  pocketDepth: number,
  scaleComp: boolean,
): Tri[] {
  const through = baseThk <= 0;
  const extra = through ? 0 : POCKET_DEPTH_EXTRA;
  const topZ = solidHeight(baseThk, pocketDepth);
  const floorZ = through ? 0 : Math.max(0, baseThk - extra);

  const inners: Loop[] = [];
  const pickHoles: Loop[] = [];
  for (const p of pockets) {
    for (const loop of p.loops) {
      if (loop.length >= 3) inners.push(loop);
    }
    if (p.pick && p.pick.r > 0.2) pickHoles.push(circleLoop(p.pick.cx, p.pick.cy, p.pick.r, 20));
  }

  const out: Tri[] = [];
  // Always cut pocket openings in the top — a solid lid z-fights and hides
  // pockets when the 3D preview orbits (painter's algorithm + backfaces).
  cap(out, outer, inners, topZ, true);
  cap(out, outer, through ? inners : pickHoles, 0, false);
  ringWalls(out, outer, 0, topZ, true);

  for (const p of pockets) {
    const picks = p.pick && p.pick.r > 0.2 ? [circleLoop(p.pick.cx, p.pick.cy, p.pick.r, 20)] : [];
    for (const pocket of p.loops) {
      if (!pocket || pocket.length < 3) continue;
      if (through) {
        ringWalls(out, pocket, 0, topZ, false);
      } else {
        cap(out, pocket, picks, floorZ, true);
        ringWalls(out, pocket, floorZ, topZ, false);
      }
    }
    if (!through) {
      for (const hole of picks) {
        ringWalls(out, hole, 0, floorZ, false);
      }
    }
  }

  const xf = plateMeshXform(outer, scaleComp);
  if (xf.s !== 1) {
    for (const t of out) {
      for (let i = 0; i < 9; i += 3) {
        t[i] = xf.cx + (t[i] - xf.cx) * xf.s;
        t[i + 1] = xf.cy + (t[i + 1] - xf.cy) * xf.s;
        t[i + 2] *= xf.s;
      }
    }
  }
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
