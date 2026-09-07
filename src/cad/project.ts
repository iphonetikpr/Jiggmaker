import type { Loop, StlMesh, UpAxis } from "../types";
import { cleanLoop, douglasPeucker, polyArea } from "./geom";

export function orientPoint(
  x: number,
  y: number,
  z: number,
  up: UpAxis,
  rotDeg: number,
  mirror: boolean,
): [number, number, number] {
  let a = x,
    b = y,
    c = z;
  switch (up) {
    case "z-":
      b = -y;
      c = -z;
      break;
    case "y+":
      b = z;
      c = y;
      break;
    case "y-":
      b = -z;
      c = -y;
      break;
    case "x+":
      a = y;
      b = z;
      c = x;
      break;
    case "x-":
      a = y;
      b = -z;
      c = -x;
      break;
    default:
      break;
  }
  if (mirror) a = -a;
  const rad = (rotDeg * Math.PI) / 180;
  const cs = Math.cos(rad),
    sn = Math.sin(rad);
  return [a * cs - b * sn, a * sn + b * cs, c];
}

export interface Projected {
  tris: Array<[[number, number], [number, number], [number, number]]>;
  bbox: [number, number, number, number];
  partHeight: number;
}

export function projectStl(mesh: StlMesh, up: UpAxis, rotDeg: number, mirror: boolean): Projected {
  const tris: Projected["tris"] = new Array(mesh.count);
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity,
    minZ = Infinity,
    maxZ = -Infinity;
  const p = mesh.positions;
  for (let i = 0, g = 0; i < mesh.count; i++) {
    const A = orientPoint(p[g], p[g + 1], p[g + 2], up, rotDeg, mirror);
    g += 3;
    const B = orientPoint(p[g], p[g + 1], p[g + 2], up, rotDeg, mirror);
    g += 3;
    const C = orientPoint(p[g], p[g + 1], p[g + 2], up, rotDeg, mirror);
    g += 3;
    tris[i] = [
      [A[0], A[1]],
      [B[0], B[1]],
      [C[0], C[1]],
    ];
    for (const v of [A, B, C]) {
      if (v[0] < minX) minX = v[0];
      if (v[0] > maxX) maxX = v[0];
      if (v[1] < minY) minY = v[1];
      if (v[1] > maxY) maxY = v[1];
      if (v[2] < minZ) minZ = v[2];
      if (v[2] > maxZ) maxZ = v[2];
    }
  }
  return { tris, bbox: [minX, minY, maxX, maxY], partHeight: maxZ - minZ };
}

function fillTriangle(
  grid: Uint8Array,
  w: number,
  h: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
) {
  const minX = Math.max(0, Math.floor(Math.min(x0, x1, x2)));
  const maxX = Math.min(w - 1, Math.ceil(Math.max(x0, x1, x2)));
  const minY = Math.max(0, Math.floor(Math.min(y0, y1, y2)));
  const maxY = Math.min(h - 1, Math.ceil(Math.max(y0, y1, y2)));
  const area = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
  if (Math.abs(area) < 1e-8) return;
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const px = x + 0.5,
        py = y + 0.5;
      const w0 = (x1 - px) * (y2 - py) - (x2 - px) * (y1 - py);
      const w1 = (x2 - px) * (y0 - py) - (x0 - px) * (y2 - py);
      const w2 = (x0 - px) * (y1 - py) - (x1 - px) * (y0 - py);
      if ((w0 >= 0 && w1 >= 0 && w2 >= 0) || (w0 <= 0 && w1 <= 0 && w2 <= 0)) {
        grid[y * w + x] = 1;
      }
    }
  }
}

function dilate(grid: Uint8Array, w: number, h: number, radiusPx: number): Uint8Array {
  if (radiusPx < 0.01) return grid;
  const dist = new Float64Array(w * h);
  const INF = 1e9;
  for (let i = 0; i < dist.length; i++) dist[i] = grid[i] ? 0 : INF;
  const c = 1,
    d = Math.SQRT2;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      let s = dist[i];
      if (y > 0) {
        if (dist[i - w] + c < s) s = dist[i - w] + c;
        if (x > 0 && dist[i - w - 1] + d < s) s = dist[i - w - 1] + d;
        if (x < w - 1 && dist[i - w + 1] + d < s) s = dist[i - w + 1] + d;
      }
      if (x > 0 && dist[i - 1] + c < s) s = dist[i - 1] + c;
      dist[i] = s;
    }
  }
  for (let y = h - 1; y >= 0; y--) {
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x;
      let s = dist[i];
      if (y < h - 1) {
        if (dist[i + w] + c < s) s = dist[i + w] + c;
        if (x < w - 1 && dist[i + w + 1] + d < s) s = dist[i + w + 1] + d;
        if (x > 0 && dist[i + w - 1] + d < s) s = dist[i + w - 1] + d;
      }
      if (x < w - 1 && dist[i + 1] + c < s) s = dist[i + 1] + c;
      dist[i] = s;
    }
  }
  const out = new Uint8Array(w * h);
  for (let i = 0; i < out.length; i++) out[i] = dist[i] <= radiusPx ? 1 : 0;
  return out;
}

function marching(grid: Uint8Array, w: number, h: number): Loop[] {
  const at = (x: number, y: number) => (x >= 0 && y >= 0 && x < w && y < h ? grid[y * w + x] : 0);
  const key = (x: number, y: number) => x * 100000 + y;
  const nodes: Record<number, [number, number]> = {};
  const node = (x: number, y: number) => {
    const k = key(x, y);
    if (!nodes[k]) nodes[k] = [x, y];
    return k;
  };
  const edges: Array<[number, number]> = [];
  const push = (a: number, b: number) => edges.push([a, b]);
  for (let y = -1; y < h; y++) {
    for (let x = -1; x < w; x++) {
      const f =
        (at(x, y) ? 1 : 0) |
        (at(x + 1, y) ? 2 : 0) |
        (at(x + 1, y + 1) ? 4 : 0) |
        (at(x, y + 1) ? 8 : 0);
      if (f === 0 || f === 15) continue;
      const s = node(2 * x + 1, 2 * y);
      const e = node(2 * x + 2, 2 * y + 1);
      const n = node(2 * x + 1, 2 * y + 2);
      const ww = node(2 * x, 2 * y + 1);
      switch (f) {
        case 1:
          push(ww, s);
          break;
        case 2:
        case 13:
          push(s, e);
          break;
        case 3:
          push(ww, e);
          break;
        case 4:
        case 11:
          push(e, n);
          break;
        case 5:
          push(ww, s);
          push(e, n);
          break;
        case 6:
        case 9:
          push(s, n);
          break;
        case 7:
          push(ww, n);
          break;
        case 8:
          push(n, ww);
          break;
        case 10:
          push(s, e);
          push(n, ww);
          break;
        case 12:
          push(e, ww);
          break;
        case 14:
          push(s, ww);
          break;
        default:
          break;
      }
    }
  }
  const adj: Record<number, number[]> = {};
  for (const [a, b] of edges) {
    (adj[a] ||= []).push(b);
    (adj[b] ||= []).push(a);
  }
  const used: Record<string, boolean> = {};
  const ek = (a: number, b: number) => (a < b ? `${a}_${b}` : `${b}_${a}`);
  const loops: Loop[] = [];
  for (const [a0, b0] of edges) {
    if (used[ek(a0, b0)]) continue;
    let prev = a0,
      cur = a0,
      next = b0;
    used[ek(a0, b0)] = true;
    const path: Loop = [nodes[cur], nodes[next]];
    cur = next;
    let guard = 0;
    while (cur !== a0 && guard++ < 1e6) {
      const nbs = adj[cur] || [];
      let found = -1;
      for (const n of nbs) {
        if (n !== prev && !used[ek(cur, n)]) {
          found = n;
          break;
        }
      }
      if (found < 0) break;
      used[ek(cur, found)] = true;
      prev = cur;
      cur = found;
      path.push(nodes[cur]);
    }
    if (path.length >= 4) loops.push(path);
  }
  return loops;
}

export function silhouetteLoops(proj: Projected, clearance: number): Loop[] {
  const [minX, minY, maxX, maxY] = proj.bbox;
  const bw = maxX - minX,
    bh = maxY - minY;
  const pixel = Math.min(0.5, Math.max(0.08, Math.max(bw, bh) / 800));
  const rad = Math.max(0, clearance) / pixel;
  const pad = Math.ceil(rad) + 2;
  const gw = Math.ceil(bw / pixel) + 2 * pad + 1;
  const gh = Math.ceil(bh / pixel) + 2 * pad + 1;
  const grid = new Uint8Array(gw * gh);
  const tx = (x: number) => (x - minX) / pixel + pad;
  const ty = (y: number) => (y - minY) / pixel + pad;
  for (const t of proj.tris) {
    fillTriangle(grid, gw, gh, tx(t[0][0]), ty(t[0][1]), tx(t[1][0]), ty(t[1][1]), tx(t[2][0]), ty(t[2][1]));
  }
  const fat = dilate(grid, gw, gh, rad);
  const raw = marching(fat, gw, gh);
  const eps = 0.9 * pixel;
  const loops: Loop[] = [];
  for (const loop of raw) {
    const mapped = loop.map(([x, y]) => [minX + (x / 2 - pad) * pixel, minY + (y / 2 - pad) * pixel] as [number, number]);
    const simp = cleanLoop(douglasPeucker(mapped, eps));
    if (simp.length >= 3 && Math.abs(polyArea(simp)) > pixel * pixel * 4) loops.push(simp);
  }
  loops.sort((a, b) => Math.abs(polyArea(b)) - Math.abs(polyArea(a)));
  return loops;
}
