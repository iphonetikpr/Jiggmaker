import { orientPoint } from "../cad/project";
import type { StlMesh, Tri, UpAxis } from "../types";

export type Rgb = [number, number, number];

export const PART_VIEW = { w: 260, h: 220 } as const;

/** Uniform (non-stretching) fit: one scale from the shorter canvas side. */
export function partViewScale(viewW: number, viewH: number, radius: number, zoom: number): number {
  return (0.46 * Math.min(viewW, viewH) * Math.max(0.01, zoom)) / (radius || 1);
}

/**
 * 3D jig tab: one scale from the shorter canvas side and the mesh radius.
 * Never uses bed W×H (333×88) or plantilla scX/scY — that mapping is 2D-only.
 */
export function jigViewScale(viewW: number, viewH: number, radius: number, zoom: number): number {
  return (0.42 * Math.min(viewW, viewH) * Math.max(0.01, zoom)) / (radius || 1);
}

export type JigOrbitCamera = {
  cx: number;
  cy: number;
  cz: number;
  sc: number;
  scX: number;
  scY: number;
};

export function jigMeshRadius(tris: Tri[], cx: number, cy: number, cz: number): number {
  let maxR = 1;
  for (const t of tris) {
    for (let i = 0; i < 9; i += 3) {
      maxR = Math.max(maxR, Math.hypot(t[i] - cx, t[i + 1] - cy, t[i + 2] - cz));
    }
  }
  return maxR;
}

/** Pure-rotation camera for the plate + pockets. `scX === scY` on every canvas size. */
export function jigOrbitCamera(
  jigW: number,
  jigH: number,
  solidH: number,
  tris: Tri[],
  viewW: number,
  viewH: number,
  zoom: number,
): JigOrbitCamera {
  const cx = jigW / 2;
  const cy = jigH / 2;
  const cz = solidH / 2;
  const sc = jigViewScale(viewW, viewH, jigMeshRadius(tris, cx, cy, cz), zoom);
  return { cx, cy, cz, sc, scX: sc, scY: sc };
}

/** Orthographic orbit. Same scale on X and Y so the mesh is never squashed. */
export function orbitProject(
  x: number,
  y: number,
  z: number,
  cx: number,
  cy: number,
  cz: number,
  az: number,
  ax: number,
  sc: number,
  viewW: number,
  viewH: number,
): [number, number, number] {
  const dx = x - cx,
    dy = y - cy,
    dz = z - cz;
  const cs = Math.cos(az),
    sn = Math.sin(az);
  const ca = Math.cos(ax),
    sa = Math.sin(ax);
  const rx = dx * cs - dy * sn;
  const ry = dx * sn + dy * cs;
  const depth = ry * sa + dz * ca;
  const py = ry * ca - dz * sa;
  return [viewW / 2 + rx * sc, viewH / 2 - py * sc, depth];
}

/** Project a mesh/rim point with the 3D jig camera (uniform `sc`, never bed scX/scY). */
export function projectJigOrbit(
  x: number,
  y: number,
  z: number,
  cam: Pick<JigOrbitCamera, "cx" | "cy" | "cz" | "sc">,
  az: number,
  ax: number,
  viewW: number,
  viewH: number,
): [number, number, number] {
  return orbitProject(x, y, z, cam.cx, cam.cy, cam.cz, az, ax, cam.sc, viewW, viewH);
}

export function rotateNormal(nx: number, ny: number, nz: number, az: number, ax: number): [number, number, number] {
  const cs = Math.cos(az),
    sn = Math.sin(az);
  const ca = Math.cos(ax),
    sa = Math.sin(ax);
  const rx = nx * cs - ny * sn;
  const ry = nx * sn + ny * cs;
  return [rx, ry * ca - nz * sa, ry * sa + nz * ca];
}

export function orientedPartBounds(
  mesh: StlMesh,
  up: UpAxis,
  rot: number,
  mirror: boolean,
): { count: number; radius: number; center: [number, number, number] } {
  const p = mesh.positions;
  let minX = Infinity,
    minY = Infinity,
    minZ = Infinity,
    maxX = -Infinity,
    maxY = -Infinity,
    maxZ = -Infinity;
  for (let g = 0; g < p.length; g += 3) {
    const q = orientPoint(p[g], p[g + 1], p[g + 2], up, rot, mirror);
    if (q[0] < minX) minX = q[0];
    if (q[1] < minY) minY = q[1];
    if (q[2] < minZ) minZ = q[2];
    if (q[0] > maxX) maxX = q[0];
    if (q[1] > maxY) maxY = q[1];
    if (q[2] > maxZ) maxZ = q[2];
  }
  const cx = (minX + maxX) / 2,
    cy = (minY + maxY) / 2,
    cz = (minZ + maxZ) / 2;
  let radius = 1;
  for (let g = 0; g < p.length; g += 3) {
    const q = orientPoint(p[g], p[g + 1], p[g + 2], up, rot, mirror);
    radius = Math.max(radius, Math.hypot(q[0] - cx, q[1] - cy, q[2] - cz));
  }
  return { count: mesh.count, radius, center: [cx, cy, cz] };
}

export function renderOrientedMesh(
  mesh: StlMesh,
  up: UpAxis,
  rot: number,
  mirror: boolean,
  viewW: number,
  viewH: number,
  az: number,
  ax: number,
  zoom: number,
  color: Rgb,
  bg: Rgb,
): { data: Uint8ClampedArray; w: number; h: number } {
  const W = Math.max(1, viewW | 0);
  const H = Math.max(1, viewH | 0);
  const pixels = W * H;
  const data = new Uint8ClampedArray(pixels * 4);
  const zbuf = new Float32Array(pixels);
  zbuf.fill(-1e30);
  for (let i = 0; i < pixels; i++) {
    data[i * 4] = bg[0];
    data[i * 4 + 1] = bg[1];
    data[i * 4 + 2] = bg[2];
    data[i * 4 + 3] = 255;
  }

  const n = mesh.count;
  if (!n) return { data, w: W, h: H };

  const p = mesh.positions;
  const pts = new Float32Array(n * 9);
  let minX = Infinity,
    minY = Infinity,
    minZ = Infinity,
    maxX = -Infinity,
    maxY = -Infinity,
    maxZ = -Infinity;
  for (let i = 0, g = 0; i < pts.length; i += 3, g += 3) {
    const q = orientPoint(p[g], p[g + 1], p[g + 2], up, rot, mirror);
    pts[i] = q[0];
    pts[i + 1] = q[1];
    pts[i + 2] = q[2];
    if (q[0] < minX) minX = q[0];
    if (q[1] < minY) minY = q[1];
    if (q[2] < minZ) minZ = q[2];
    if (q[0] > maxX) maxX = q[0];
    if (q[1] > maxY) maxY = q[1];
    if (q[2] > maxZ) maxZ = q[2];
  }
  const cx = (minX + maxX) / 2,
    cy = (minY + maxY) / 2,
    cz = (minZ + maxZ) / 2;
  let radius = 1;
  for (let i = 0; i < pts.length; i += 3) {
    radius = Math.max(radius, Math.hypot(pts[i] - cx, pts[i + 1] - cy, pts[i + 2] - cz));
  }
  const sc = partViewScale(W, H, radius, zoom);
  const light: Rgb = [0.35, 0.55, 0.85];
  const lightLen = Math.hypot(light[0], light[1], light[2]) || 1;
  const lx = light[0] / lightLen,
    ly = light[1] / lightLen,
    lz = light[2] / lightLen;

  for (let t = 0; t < n; t++) {
    const o = t * 9;
    const A = orbitProject(pts[o], pts[o + 1], pts[o + 2], cx, cy, cz, az, ax, sc, W, H);
    const B = orbitProject(pts[o + 3], pts[o + 4], pts[o + 5], cx, cy, cz, az, ax, sc, W, H);
    const C = orbitProject(pts[o + 6], pts[o + 7], pts[o + 8], cx, cy, cz, az, ax, sc, W, H);
    const area = (B[0] - A[0]) * (C[1] - A[1]) - (C[0] - A[0]) * (B[1] - A[1]);
    if (Math.abs(area) < 0.02) continue;

    const ux = pts[o + 3] - pts[o],
      uy = pts[o + 4] - pts[o + 1],
      uz = pts[o + 5] - pts[o + 2];
    const vx = pts[o + 6] - pts[o],
      vy = pts[o + 7] - pts[o + 1],
      vz = pts[o + 8] - pts[o + 2];
    let nx = uy * vz - uz * vy,
      ny = uz * vx - ux * vz,
      nz = ux * vy - uy * vx;
    const nlen = Math.hypot(nx, ny, nz) || 1;
    const [vnX, vnY, vnZ] = rotateNormal(nx / nlen, ny / nlen, nz / nlen, az, ax);
    const lambert = Math.abs(vnX * lx + vnY * ly + vnZ * lz);
    const shade = 0.28 + 0.72 * lambert;
    const cr = color[0] * shade,
      cg = color[1] * shade,
      cb = color[2] * shade;

    const minPx = Math.max(0, Math.floor(Math.min(A[0], B[0], C[0])));
    const maxPx = Math.min(W - 1, Math.ceil(Math.max(A[0], B[0], C[0])));
    const minPy = Math.max(0, Math.floor(Math.min(A[1], B[1], C[1])));
    const maxPy = Math.min(H - 1, Math.ceil(Math.max(A[1], B[1], C[1])));

    for (let py = minPy; py <= maxPy; py++) {
      for (let px = minPx; px <= maxPx; px++) {
        const sx = px + 0.5,
          sy = py + 0.5;
        const w0 = (B[0] - sx) * (C[1] - sy) - (C[0] - sx) * (B[1] - sy);
        const w1 = (C[0] - sx) * (A[1] - sy) - (A[0] - sx) * (C[1] - sy);
        const w2 = (A[0] - sx) * (B[1] - sy) - (B[0] - sx) * (A[1] - sy);
        if (!((w0 >= 0 && w1 >= 0 && w2 >= 0) || (w0 <= 0 && w1 <= 0 && w2 <= 0))) continue;
        const sum = w0 + w1 + w2;
        if (sum === 0) continue;
        const z = (w0 * A[2] + w1 * B[2] + w2 * C[2]) / sum;
        const idx = py * W + px;
        if (z <= zbuf[idx]) continue;
        zbuf[idx] = z;
        const di = idx * 4;
        data[di] = cr;
        data[di + 1] = cg;
        data[di + 2] = cb;
        data[di + 3] = 255;
      }
    }
  }
  return { data, w: W, h: H };
}
