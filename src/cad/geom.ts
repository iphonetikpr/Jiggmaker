import type { Loop, Pt } from "../types";

export function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

export function polyArea(loop: Loop): number {
  let a = 0;
  for (let i = 0; i < loop.length; i++) {
    const j = (i + 1) % loop.length;
    a += loop[i][0] * loop[j][1] - loop[j][0] * loop[i][1];
  }
  return a / 2;
}

export function ensureCCW(loop: Loop): Loop {
  return polyArea(loop) < 0 ? loop.slice().reverse() : loop;
}

export function ensureCW(loop: Loop): Loop {
  return polyArea(loop) > 0 ? loop.slice().reverse() : loop;
}

export function translateLoop(loop: Loop, dx: number, dy: number): Loop {
  return loop.map(([x, y]) => [x + dx, y + dy]);
}

export function scaleLoop(loop: Loop, s: number, ox: number, oy: number): Loop {
  return loop.map(([x, y]) => [ox + (x - ox) * s, oy + (y - oy) * s]);
}

export function bboxOf(loops: Loop[]): { minX: number; minY: number; maxX: number; maxY: number; w: number; h: number } {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const loop of loops) {
    for (const [x, y] of loop) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  if (!isFinite(minX)) return { minX: 0, minY: 0, maxX: 0, maxY: 0, w: 0, h: 0 };
  return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
}

export function originLoops(loops: Loop[]): { loops: Loop[]; w: number; h: number; ox: number; oy: number } {
  const b = bboxOf(loops);
  return {
    loops: loops.map((l) => translateLoop(l, -b.minX, -b.minY)),
    w: b.w,
    h: b.h,
    ox: b.minX,
    oy: b.minY,
  };
}

export function rectLoop(w: number, h: number, x = 0, y = 0): Loop {
  return [
    [x, y],
    [x + w, y],
    [x + w, y + h],
    [x, y + h],
  ];
}

/** Axis-aligned rectangle grown by clearance on each side. bbox = [minX, minY, maxX, maxY] */
export function inflatedRect(bbox: [number, number, number, number], clearance: number, corner = 0): Loop[] {
  const a = bbox[0] - clearance;
  const b = bbox[1] - clearance;
  const c = bbox[2] + clearance;
  const d = bbox[3] + clearance;
  return [roundedRectLoop(a, b, c - a, d - b, corner)];
}

export function roundedRectLoop(x: number, y: number, w: number, h: number, r: number, segs = 8): Loop {
  if (r <= 0) return rectLoop(w, h, x, y);
  const u = Math.min(r, w / 2, h / 2);
  const pts: Loop = [];
  const arc = (cx: number, cy: number, a0: number, a1: number) => {
    for (let i = 0; i <= segs; i++) {
      const a = a0 + ((a1 - a0) * i) / segs;
      pts.push([cx + u * Math.cos(a), cy + u * Math.sin(a)]);
    }
  };
  arc(x + w - u, y + u, -Math.PI / 2, 0);
  arc(x + w - u, y + h - u, 0, Math.PI / 2);
  arc(x + u, y + h - u, Math.PI / 2, Math.PI);
  arc(x + u, y + u, Math.PI, 1.5 * Math.PI);
  return pts;
}

export function circleLoop(cx: number, cy: number, r: number, n = 24): Loop {
  const pts: Loop = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return pts;
}

export function pointInPoly(pt: Pt, loop: Loop): boolean {
  const [x, y] = pt;
  let inside = false;
  for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
    const xi = loop[i][0],
      yi = loop[i][1];
    const xj = loop[j][0],
      yj = loop[j][1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function dist2(a: Pt, b: Pt): number {
  const dx = a[0] - b[0],
    dy = a[1] - b[1];
  return dx * dx + dy * dy;
}

function perpDist(p: Pt, a: Pt, b: Pt): number {
  const dx = b[0] - a[0],
    dy = b[1] - a[1];
  const len = Math.hypot(dx, dy) || 1;
  return Math.abs((p[0] - a[0]) * dy - (p[1] - a[1]) * dx) / len;
}

function dpRec(pts: Loop, eps: number): Loop {
  if (pts.length < 3) return pts;
  let maxD = 0,
    idx = 0;
  const last = pts.length - 1;
  for (let i = 1; i < last; i++) {
    const d = perpDist(pts[i], pts[0], pts[last]);
    if (d > maxD) {
      maxD = d;
      idx = i;
    }
  }
  if (maxD > eps) {
    const left = dpRec(pts.slice(0, idx + 1), eps);
    const right = dpRec(pts.slice(idx), eps);
    return left.slice(0, -1).concat(right);
  }
  return [pts[0], pts[last]];
}

export function douglasPeucker(loop: Loop, eps: number): Loop {
  if (loop.length < 4) return loop;
  let far = 0,
    farI = 0;
  for (let i = 1; i < loop.length; i++) {
    const d = dist2(loop[0], loop[i]);
    if (d > far) {
      far = d;
      farI = i;
    }
  }
  const a = dpRec(loop.slice(0, farI + 1), eps);
  const b = dpRec(loop.slice(farI).concat([loop[0]]), eps);
  return a.slice(0, -1).concat(b.slice(0, -1));
}

export function cleanLoop(loop: Loop, min = 0.02): Loop {
  const out: Loop = [];
  for (const p of loop) {
    const last = out[out.length - 1];
    if (!last || Math.hypot(p[0] - last[0], p[1] - last[1]) >= min) out.push(p);
  }
  if (out.length > 2) {
    const a = out[0],
      b = out[out.length - 1];
    if (Math.hypot(a[0] - b[0], a[1] - b[1]) < min) out.pop();
  }
  return out;
}

export function sanitizeName(name: string, fallback = "jig"): string {
  const s = String(name || fallback)
    .replace(/[^\w\-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 30);
  return s || fallback;
}
