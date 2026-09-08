import type { Tri } from "../types";
import {
  type JigOrbitCamera,
  type Rgb,
  orbitProject,
  rotateNormal,
} from "./partView";

export const JIG_MESH_BG: Rgb = [32, 32, 36];
export const JIG_SAMPLE_IDLE = 1.5;
export const JIG_SAMPLE_DRAG = 1;
export const JIG_SAMPLE_MAX = 2200;

/** Key from upper-right; fill from the opposite side so walls stay readable. */
export const JIG_KEY: Rgb = [0.42, 0.28, 0.86];
export const JIG_FILL: Rgb = [-0.55, 0.48, 0.38];

const KEY_LEN = Math.hypot(...JIG_KEY) || 1;
const FILL_LEN = Math.hypot(...JIG_FILL) || 1;
const KEY: Rgb = [JIG_KEY[0] / KEY_LEN, JIG_KEY[1] / KEY_LEN, JIG_KEY[2] / KEY_LEN];
const FILL: Rgb = [JIG_FILL[0] / FILL_LEN, JIG_FILL[1] / FILL_LEN, JIG_FILL[2] / FILL_LEN];

export function jigPreviewSample(
  cssW: number,
  cssH: number,
  dpr: number,
  dragging: boolean,
): { w: number; h: number; scale: number } {
  const aspect = Math.max(1, cssW) / Math.max(1, cssH);
  const scale = dragging ? JIG_SAMPLE_DRAG : JIG_SAMPLE_IDLE;
  const w = Math.min(JIG_SAMPLE_MAX, Math.max(1, Math.round(cssW * Math.max(1, dpr) * scale)));
  const h = Math.max(1, Math.round(w / aspect));
  return { w, h, scale };
}

/**
 * Lambert key + fill, then height AO so pocket floors read darker than the plate top.
 * `vn` is the view-space normal.
 */
export function jigFaceShade(vn: Rgb, avgZ: number, minZ: number, maxZ: number): number {
  const ndotKey = Math.max(0, vn[0] * KEY[0] + vn[1] * KEY[1] + vn[2] * KEY[2]);
  const ndotFill = Math.max(0, vn[0] * FILL[0] + vn[1] * FILL[1] + vn[2] * FILL[2]);
  const lit = 0.18 + 0.64 * ndotKey + 0.3 * ndotFill;
  const span = maxZ - minZ || 1;
  const height01 = (avgZ - minZ) / span;
  const floorish = Math.max(0, vn[2]) * (1 - height01);
  const ao = 0.42 + 0.58 * height01 - 0.2 * floorish;
  return Math.max(0.08, Math.min(1, lit * ao));
}

export function renderJigMesh(
  tris: Tri[],
  cam: Pick<JigOrbitCamera, "cx" | "cy" | "cz" | "sc">,
  az: number,
  ax: number,
  viewW: number,
  viewH: number,
  color: Rgb,
  bg: Rgb = JIG_MESH_BG,
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
  if (!tris.length) return { data, w: W, h: H };

  let minZ = Infinity,
    maxZ = -Infinity;
  for (const t of tris) {
    for (let i = 2; i < 9; i += 3) {
      if (t[i] < minZ) minZ = t[i];
      if (t[i] > maxZ) maxZ = t[i];
    }
  }

  for (let i = 0; i < tris.length; i++) {
    const t = tris[i];
    const A = orbitProject(t[0], t[1], t[2], cam.cx, cam.cy, cam.cz, az, ax, cam.sc, W, H);
    const B = orbitProject(t[3], t[4], t[5], cam.cx, cam.cy, cam.cz, az, ax, cam.sc, W, H);
    const C = orbitProject(t[6], t[7], t[8], cam.cx, cam.cy, cam.cz, az, ax, cam.sc, W, H);
    const area = (B[0] - A[0]) * (C[1] - A[1]) - (C[0] - A[0]) * (B[1] - A[1]);
    if (area >= 0) continue;

    const ux = t[3] - t[0],
      uy = t[4] - t[1],
      uz = t[5] - t[2];
    const vx = t[6] - t[0],
      vy = t[7] - t[1],
      vz = t[8] - t[2];
    let nx = uy * vz - uz * vy,
      ny = uz * vx - ux * vz,
      nz = ux * vy - uy * vx;
    const nlen = Math.hypot(nx, ny, nz) || 1;
    const vn = rotateNormal(nx / nlen, ny / nlen, nz / nlen, az, ax);
    const avgZ = (t[2] + t[5] + t[8]) / 3;
    const shade = jigFaceShade(vn, avgZ, minZ, maxZ);
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

export function hexToRgb(color: string): Rgb {
  const n = color.replace("#", "");
  const full = n.length === 3 ? n[0] + n[0] + n[1] + n[1] + n[2] + n[2] : n;
  const v = parseInt(full, 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

export function jigHudCaption(triCount: number, jigW: number, jigH: number, solidH: number): string {
  const tris = triCount.toLocaleString("en-US");
  return `drag to rotate · scroll to zoom · click a cube face · ${tris} tris · ${jigW.toFixed(0)}×${jigH.toFixed(0)}×${solidH.toFixed(1)} mm`;
}

/** Square gizmo in CSS pixels. `sc` is identical on X and Y — never the bed 333×88 mapping. */
export const VIEWCUBE = {
  size: 84,
  margin: 12,
  sc: 22,
} as const;

export type ViewCubeFaceId = "TOP" | "BTM" | "FRONT" | "BACK" | "RIGHT" | "LEFT";

export type ViewCubeFace = {
  lbl: ViewCubeFaceId;
  n: Rgb;
  corners: Array<[number, number, number]>;
  view: { ax: number; az: number };
  vis: boolean;
  poly: Array<[number, number, number]>;
};

const FACE_DEFS: Array<Omit<ViewCubeFace, "vis" | "poly">> = [
  { lbl: "TOP", n: [0, 0, 1], corners: [[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]], view: { ax: 0, az: 0 } },
  { lbl: "BTM", n: [0, 0, -1], corners: [[-1, 1, -1], [1, 1, -1], [1, -1, -1], [-1, -1, -1]], view: { ax: -Math.PI, az: 0 } },
  { lbl: "FRONT", n: [0, -1, 0], corners: [[-1, -1, -1], [1, -1, -1], [1, -1, 1], [-1, -1, 1]], view: { ax: -Math.PI / 2, az: 0 } },
  { lbl: "BACK", n: [0, 1, 0], corners: [[1, 1, -1], [-1, 1, -1], [-1, 1, 1], [1, 1, 1]], view: { ax: -Math.PI / 2, az: Math.PI } },
  { lbl: "RIGHT", n: [1, 0, 0], corners: [[1, -1, -1], [1, 1, -1], [1, 1, 1], [1, -1, 1]], view: { ax: -Math.PI / 2, az: -Math.PI / 2 } },
  { lbl: "LEFT", n: [-1, 0, 0], corners: [[-1, 1, -1], [-1, -1, -1], [-1, -1, 1], [-1, 1, 1]], view: { ax: -Math.PI / 2, az: Math.PI / 2 } },
];

export type ViewCubeLayout = {
  cx: number;
  cy: number;
  sc: number;
  scX: number;
  scY: number;
  viewportW: number;
  viewportH: number;
  az: number;
  ax: number;
  faces: ViewCubeFace[];
};

export function viewCubeLayout(viewW: number, viewH: number, az: number, ax: number): ViewCubeLayout {
  const sc = VIEWCUBE.sc;
  const half = VIEWCUBE.size / 2;
  const cx = Math.max(half + 4, viewW - VIEWCUBE.margin - half);
  const cy = Math.min(Math.max(half + 4, viewH - half - 4), VIEWCUBE.margin + half);
  const cs = Math.cos(az),
    sn = Math.sin(az);
  const ca = Math.cos(ax),
    sa = Math.sin(ax);
  const project = (x: number, y: number, z: number): [number, number, number] => {
    const rx = x * cs - y * sn;
    const ry = x * sn + y * cs;
    const depth = ry * sa + z * ca;
    const py = ry * ca - z * sa;
    return [cx + rx * sc, cy - py * sc, depth];
  };
  const faces: ViewCubeFace[] = FACE_DEFS.map((def) => {
    const vis = (def.n[0] * sn + def.n[1] * cs) * sa + def.n[2] * ca > 0.02;
    return { ...def, vis, poly: def.corners.map(([x, y, z]) => project(x, y, z)) };
  });
  const visible = faces.filter((f) => f.vis);
  visible.sort((a, b) => {
    const da = a.poly[0][2] + a.poly[1][2] + a.poly[2][2] + a.poly[3][2];
    const db = b.poly[0][2] + b.poly[1][2] + b.poly[2][2] + b.poly[3][2];
    return da - db;
  });
  return { cx, cy, sc, scX: sc, scY: sc, viewportW: VIEWCUBE.size, viewportH: VIEWCUBE.size, az, ax, faces: visible };
}

function pointInPoly(x: number, y: number, poly: Array<[number, number, number]>): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const yi = poly[i][1],
      yj = poly[j][1];
    const xi = poly[i][0],
      xj = poly[j][0];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi || 1e-12) + xi) inside = !inside;
  }
  return inside;
}

/** Front-most face under the cursor (CSS pixels). */
export function hitViewCubeFace(layout: ViewCubeLayout, x: number, y: number): ViewCubeFace | null {
  for (let i = layout.faces.length - 1; i >= 0; i--) {
    if (pointInPoly(x, y, layout.faces[i].poly)) return layout.faces[i];
  }
  return null;
}

export function drawViewCube(ctx: CanvasRenderingContext2D, layout: ViewCubeLayout): void {
  ctx.save();
  const x = layout.cx - layout.viewportW / 2;
  const y = layout.cy - layout.viewportH / 2;
  ctx.beginPath();
  if (typeof ctx.roundRect === "function") ctx.roundRect(x, y, layout.viewportW, layout.viewportH, 10);
  else ctx.rect(x, y, layout.viewportW, layout.viewportH);
  ctx.fillStyle = "rgba(15, 20, 25, 0.55)";
  ctx.fill();
  ctx.strokeStyle = "rgba(139, 154, 171, 0.45)";
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.lineJoin = "round";
  ctx.lineWidth = 1;
  ctx.font = "bold 8px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (const face of layout.faces) {
    ctx.beginPath();
    face.poly.forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
    ctx.closePath();
    const vn = rotateNormal(face.n[0], face.n[1], face.n[2], layout.az, layout.ax);
    const tilt = 0.62 + 0.38 * Math.max(0, vn[2] * 0.55 + vn[0] * 0.25 + 0.2);
    ctx.fillStyle = `rgba(${Math.round(220 * tilt)},${Math.round(226 * tilt)},${Math.round(234 * tilt)},0.96)`;
    ctx.fill();
    ctx.strokeStyle = "#5b6b7c";
    ctx.stroke();
    const cx = (face.poly[0][0] + face.poly[1][0] + face.poly[2][0] + face.poly[3][0]) / 4;
    const cy = (face.poly[0][1] + face.poly[1][1] + face.poly[2][1] + face.poly[3][1]) / 4;
    ctx.fillStyle = "#1A222C";
    ctx.fillText(face.lbl, cx, cy);
  }
  ctx.restore();
}

export function shortestAzDelta(from: number, to: number): number {
  let d = to - from;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
}
