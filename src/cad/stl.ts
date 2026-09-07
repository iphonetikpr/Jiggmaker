import type { StlMesh } from "../types";

function isBinaryStl(buf: ArrayBuffer): boolean {
  if (buf.byteLength < 84) return false;
  const view = new DataView(buf);
  const n = view.getUint32(80, true);
  return 84 + 50 * n === buf.byteLength;
}

function parseBinary(buf: ArrayBuffer): StlMesh {
  const view = new DataView(buf);
  const n = view.getUint32(80, true);
  const positions = new Float32Array(n * 9);
  let o = 84;
  let p = 0;
  for (let i = 0; i < n; i++) {
    o += 12;
    for (let k = 0; k < 9; k++, p++, o += 4) positions[p] = view.getFloat32(o, true);
    o += 2;
  }
  return { positions, count: n };
}

function parseAscii(buf: ArrayBuffer): StlMesh {
  const text = new TextDecoder("latin1").decode(buf);
  const nums: number[] = [];
  const re = /vertex\s+([^\s]+)\s+([^\s]+)\s+([^\s]+)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    nums.push(+m[1], +m[2], +m[3]);
  }
  if (nums.length < 9 || nums.length % 9 !== 0) {
    throw new Error("ASCII STL has no complete triangles");
  }
  return { positions: Float32Array.from(nums), count: nums.length / 9 };
}

export function parseSTL(buf: ArrayBuffer): StlMesh {
  if (isBinaryStl(buf)) return parseBinary(buf);
  const head = new TextDecoder("latin1").decode(buf.slice(0, 256));
  if (/^\s*solid/i.test(head)) return parseAscii(buf);
  if (buf.byteLength >= 84) {
    try {
      return parseBinary(buf);
    } catch {
      /* fall through */
    }
  }
  throw new Error("Unrecognized STL");
}

export function makeBoxStl(w: number, h: number, d: number): ArrayBuffer {
  const x0 = 0,
    y0 = 0,
    z0 = 0,
    x1 = w,
    y1 = h,
    z1 = d;
  const faces: Array<[[number, number, number], [number, number, number], [number, number, number]]> = [
    [
      [x0, y0, z0],
      [x1, y0, z0],
      [x1, y1, z0],
    ],
    [
      [x0, y0, z0],
      [x1, y1, z0],
      [x0, y1, z0],
    ],
    [
      [x0, y0, z1],
      [x1, y1, z1],
      [x1, y0, z1],
    ],
    [
      [x0, y0, z1],
      [x0, y1, z1],
      [x1, y1, z1],
    ],
    [
      [x0, y0, z0],
      [x0, y0, z1],
      [x1, y0, z1],
    ],
    [
      [x0, y0, z0],
      [x1, y0, z1],
      [x1, y0, z0],
    ],
    [
      [x0, y1, z0],
      [x1, y1, z0],
      [x1, y1, z1],
    ],
    [
      [x0, y1, z0],
      [x1, y1, z1],
      [x0, y1, z1],
    ],
    [
      [x0, y0, z0],
      [x0, y1, z0],
      [x0, y1, z1],
    ],
    [
      [x0, y0, z0],
      [x0, y1, z1],
      [x0, y0, z1],
    ],
    [
      [x1, y0, z0],
      [x1, y0, z1],
      [x1, y1, z1],
    ],
    [
      [x1, y0, z0],
      [x1, y1, z1],
      [x1, y1, z0],
    ],
  ];
  const n = faces.length;
  const buf = new ArrayBuffer(84 + 50 * n);
  const view = new DataView(buf);
  view.setUint32(80, n, true);
  let o = 84;
  for (const f of faces) {
    const ux = f[1][0] - f[0][0],
      uy = f[1][1] - f[0][1],
      uz = f[1][2] - f[0][2];
    const vx = f[2][0] - f[0][0],
      vy = f[2][1] - f[0][1],
      vz = f[2][2] - f[0][2];
    let nx = uy * vz - uz * vy,
      ny = uz * vx - ux * vz,
      nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len;
    ny /= len;
    nz /= len;
    view.setFloat32(o, nx, true);
    view.setFloat32(o + 4, ny, true);
    view.setFloat32(o + 8, nz, true);
    o += 12;
    for (const v of f) {
      view.setFloat32(o, v[0], true);
      view.setFloat32(o + 4, v[1], true);
      view.setFloat32(o + 8, v[2], true);
      o += 12;
    }
    view.setUint16(o, 0, true);
    o += 2;
  }
  return buf;
}

/** L-footprint prism (40×15 bar + 15×30 stem) for silhouette tests. */
export function makeLStl(d = 8): ArrayBuffer {
  return mergeBinaryStl([makeBoxStl(40, 15, d), makeBoxStl(15, 30, d)]);
}

function mergeBinaryStl(bufs: ArrayBuffer[]): ArrayBuffer {
  const meshes = bufs.map(parseSTL);
  const n = meshes.reduce((s, m) => s + m.count, 0);
  const out = new ArrayBuffer(84 + 50 * n);
  const view = new DataView(out);
  view.setUint32(80, n, true);
  let o = 84;
  for (const m of meshes) {
    const p = m.positions;
    for (let i = 0; i < m.count; i++) {
      const g = i * 9;
      const ux = p[g + 3] - p[g],
        uy = p[g + 4] - p[g + 1],
        uz = p[g + 5] - p[g + 2];
      const vx = p[g + 6] - p[g],
        vy = p[g + 7] - p[g + 1],
        vz = p[g + 8] - p[g + 2];
      let nx = uy * vz - uz * vy,
        ny = uz * vx - ux * vz,
        nz = ux * vy - uy * vx;
      const len = Math.hypot(nx, ny, nz) || 1;
      view.setFloat32(o, nx / len, true);
      view.setFloat32(o + 4, ny / len, true);
      view.setFloat32(o + 8, nz / len, true);
      o += 12;
      for (let k = 0; k < 9; k++, o += 4) view.setFloat32(o, p[g + k], true);
      view.setUint16(o, 0, true);
      o += 2;
    }
  }
  return out;
}
