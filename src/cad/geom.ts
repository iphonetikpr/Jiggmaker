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

function centroidOf(loop: Loop): Pt {
  let x = 0,
    y = 0;
  for (const p of loop) {
    x += p[0];
    y += p[1];
  }
  const n = loop.length || 1;
  return [x / n, y / n];
}

function segmentsProperlyCross(a: Pt, b: Pt, c: Pt, d: Pt): boolean {
  const side = (p: Pt, q: Pt, s: Pt) => (q[0] - p[0]) * (s[1] - p[1]) - (q[1] - p[1]) * (s[0] - p[0]);
  const d1 = side(c, d, a);
  const d2 = side(c, d, b);
  const d3 = side(a, b, c);
  const d4 = side(a, b, d);
  return ((d1 > 1e-9 && d2 < -1e-9) || (d1 < -1e-9 && d2 > 1e-9)) && ((d3 > 1e-9 && d4 < -1e-9) || (d3 < -1e-9 && d4 > 1e-9));
}

/**
 * Closed loops with overlapping area. Shared edges and corner touches do not count.
 * Samples the bbox intersection so axis-aligned pockets that overlap without a
 * proper edge crossing (identical Y span) are still caught.
 */
export function loopsOverlap(a: Loop, b: Loop, eps = 0.05): boolean {
  if (a.length < 3 || b.length < 3) return false;
  const ba = bboxOf([a]);
  const bb = bboxOf([b]);
  const x0 = Math.max(ba.minX, bb.minX);
  const y0 = Math.max(ba.minY, bb.minY);
  const x1 = Math.min(ba.maxX, bb.maxX);
  const y1 = Math.min(ba.maxY, bb.maxY);
  if (x1 - x0 <= eps || y1 - y0 <= eps) return false;
  const samples: Pt[] = [
    [(x0 + x1) / 2, (y0 + y1) / 2],
    [x0 + (x1 - x0) * 0.25, y0 + (y1 - y0) * 0.5],
    [x0 + (x1 - x0) * 0.75, y0 + (y1 - y0) * 0.5],
    [x0 + (x1 - x0) * 0.5, y0 + (y1 - y0) * 0.25],
    [x0 + (x1 - x0) * 0.5, y0 + (y1 - y0) * 0.75],
  ];
  for (const p of samples) {
    if (pointInPoly(p, a) && pointInPoly(p, b)) return true;
  }
  for (let i = 0; i < a.length; i++) {
    const a1 = a[i];
    const a2 = a[(i + 1) % a.length];
    for (let j = 0; j < b.length; j++) {
      if (segmentsProperlyCross(a1, a2, b[j], b[(j + 1) % b.length])) return true;
    }
  }
  return pointInPoly(centroidOf(a), b) || pointInPoly(centroidOf(b), a);
}

/** Smaller bbox overlap axis, in mm. 0 when the boxes only touch. */
export function loopsOverlapDepth(a: Loop, b: Loop): number {
  const ba = bboxOf([a]);
  const bb = bboxOf([b]);
  const ox = Math.min(ba.maxX, bb.maxX) - Math.max(ba.minX, bb.minX);
  const oy = Math.min(ba.maxY, bb.maxY) - Math.max(ba.minY, bb.minY);
  if (ox <= 0 || oy <= 0) return 0;
  return Math.min(ox, oy);
}

/** Even nesting depth: outers and islands. Odd depth: holes. */
export function classifyContours(loops: Loop[]): { outers: Loop[]; holes: Loop[] } {
  const ranked = loops.filter((loop) => loop.length >= 3).map((loop) => ({ loop, abs: Math.abs(polyArea(loop)) }));
  const depth = ranked.map(() => 0);
  for (let i = 0; i < ranked.length; i++) {
    const probe = interiorProbe(ranked[i].loop);
    if (!probe) continue;
    for (let j = 0; j < ranked.length; j++) {
      if (i === j || ranked[j].abs <= ranked[i].abs + 1e-4) continue;
      if (pointInPoly(probe, ranked[j].loop)) depth[i]++;
    }
  }
  const outers: Loop[] = [];
  const holes: Loop[] = [];
  ranked.forEach((item, i) => {
    if (depth[i] % 2 === 1) holes.push(item.loop);
    else outers.push(item.loop);
  });
  return { outers, holes };
}

function interiorProbe(loop: Loop): Pt | null {
  const box = bboxOf([loop]);
  const center: Pt = [(box.minX + box.maxX) / 2, (box.minY + box.maxY) / 2];
  if (pointInPoly(center, loop)) return center;
  let x = 0,
    y = 0;
  for (const p of loop) {
    x += p[0];
    y += p[1];
  }
  const mean: Pt = [x / loop.length, y / loop.length];
  if (pointInPoly(mean, loop)) return mean;
  return null;
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

function intersectAtX(a: Pt, b: Pt, x: number): Pt {
  const dx = b[0] - a[0];
  if (Math.abs(dx) < 1e-15) return [x, a[1]];
  const t = (x - a[0]) / dx;
  return [x, a[1] + t * (b[1] - a[1])];
}

function intersectAtY(a: Pt, b: Pt, y: number): Pt {
  const dy = b[1] - a[1];
  if (Math.abs(dy) < 1e-15) return [a[0], y];
  const t = (y - a[1]) / dy;
  return [a[0] + t * (b[0] - a[0]), y];
}

function clipPolyHalf(poly: Loop, inside: (p: Pt) => boolean, intersect: (a: Pt, b: Pt) => Pt): Loop {
  if (poly.length < 3) return [];
  const out: Loop = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const aIn = inside(a);
    const bIn = inside(b);
    if (bIn) {
      if (!aIn) out.push(intersect(a, b));
      out.push(b);
    } else if (aIn) {
      out.push(intersect(a, b));
    }
  }
  return out;
}

/** Convex clip of a (possibly concave) loop to an axis-aligned rectangle. */
export function clipLoopToRect(loop: Loop, x0: number, y0: number, x1: number, y1: number): Loop {
  let poly = loop;
  poly = clipPolyHalf(poly, (p) => p[0] >= x0 - 1e-12, (a, b) => intersectAtX(a, b, x0));
  poly = clipPolyHalf(poly, (p) => p[0] <= x1 + 1e-12, (a, b) => intersectAtX(a, b, x1));
  poly = clipPolyHalf(poly, (p) => p[1] >= y0 - 1e-12, (a, b) => intersectAtY(a, b, y0));
  poly = clipPolyHalf(poly, (p) => p[1] <= y1 + 1e-12, (a, b) => intersectAtY(a, b, y1));
  return cleanLoop(poly, 1e-9);
}

/** Drop middle vertices that lie on a straight edge so cut sides are a single segment. */
export function mergeCollinear(loop: Loop, eps = 1e-7): Loop {
  if (loop.length < 3) return loop;
  const keep = (a: Pt, b: Pt, c: Pt) => {
    const cross = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    const dot = (b[0] - a[0]) * (c[0] - b[0]) + (b[1] - a[1]) * (c[1] - b[1]);
    return Math.abs(cross) > eps || dot < 0;
  };
  const pts = loop.slice();
  let changed = true;
  while (changed && pts.length >= 3) {
    changed = false;
    for (let i = 0; i < pts.length; ) {
      const a = pts[(i + pts.length - 1) % pts.length];
      const b = pts[i];
      const c = pts[(i + 1) % pts.length];
      if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 1e-9) {
        pts.splice(i, 1);
        changed = true;
        continue;
      }
      if (!keep(a, b, c)) {
        pts.splice(i, 1);
        changed = true;
        continue;
      }
      i++;
    }
  }
  return pts;
}

/** Right-hand normal of a CCW edge: points outward. */
function outwardNormal(a: Pt, b: Pt): Pt {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy) || 1;
  return [dy / len, -dx / len];
}

/**
 * Offset a closed loop. Positive distance grows it (outward for a CCW ring).
 * One output vertex per input vertex so a chamfer can pair mouth and seat.
 */
function intersectLines(origin: Pt, dir: Pt, origin2: Pt, dir2: Pt): Pt | null {
  const den = dir[0] * dir2[1] - dir[1] * dir2[0];
  if (Math.abs(den) < 1e-12) return null;
  const t = ((origin2[0] - origin[0]) * dir2[1] - (origin2[1] - origin[1]) * dir2[0]) / den;
  return [origin[0] + t * dir[0], origin[1] + t * dir[1]];
}

/** Points strictly between `from` and `to` on the short arc around `center`. */
function arcBetween(center: Pt, from: Pt, to: Pt, radius: number, stepDeg = 6): Pt[] {
  const a0 = Math.atan2(from[1] - center[1], from[0] - center[0]);
  const a1 = Math.atan2(to[1] - center[1], to[0] - center[0]);
  let sweep = a1 - a0;
  const cross = (from[0] - center[0]) * (to[1] - center[1]) - (from[1] - center[1]) * (to[0] - center[0]);
  if (cross > 0 && sweep < 0) sweep += Math.PI * 2;
  if (cross < 0 && sweep > 0) sweep -= Math.PI * 2;
  const steps = Math.max(1, Math.ceil(Math.abs(sweep) / ((stepDeg * Math.PI) / 180)));
  const pts: Pt[] = [];
  for (let i = 1; i < steps; i++) {
    const a = a0 + (sweep * i) / steps;
    pts.push([center[0] + radius * Math.cos(a), center[1] + radius * Math.sin(a)]);
  }
  return pts;
}

/**
 * Offset a closed loop. Positive distance grows a CCW ring.
 * Convex corners (relative to the offset) are round joins of radius |distance|,
 * so the clearance at a corner equals the clearance along the edges.
 */
export function offsetLoopRound(loop: Loop, distance: number): Loop | null {
  if (!Number.isFinite(distance)) return null;
  const pts = ensureCCW(cleanLoop(loop, 1e-6));
  if (pts.length < 3) return null;
  if (Math.abs(distance) < 1e-9) return pts;
  const n = pts.length;
  const rad = Math.abs(distance);
  const out: Loop = [];
  for (let i = 0; i < n; i++) {
    const prev = pts[(i + n - 1) % n];
    const cur = pts[i];
    const next = pts[(i + 1) % n];
    const n0 = outwardNormal(prev, cur);
    const n1 = outwardNormal(cur, next);
    const a: Pt = [cur[0] + n0[0] * distance, cur[1] + n0[1] * distance];
    const b: Pt = [cur[0] + n1[0] * distance, cur[1] + n1[1] * distance];
    const cross = (cur[0] - prev[0]) * (next[1] - cur[1]) - (cur[1] - prev[1]) * (next[0] - cur[0]);
    const useArc = (distance > 0 && cross > 1e-8) || (distance < 0 && cross < -1e-8);
    if (!useArc) {
      const hit = intersectLines(a, [cur[0] - prev[0], cur[1] - prev[1]], b, [next[0] - cur[0], next[1] - cur[1]]);
      out.push(hit ?? a);
      continue;
    }
    out.push(a);
    for (const p of arcBetween(cur, a, b, rad)) out.push(p);
    out.push(b);
  }
  const cleaned = cleanLoop(out, 1e-5);
  return cleaned.length >= 3 ? cleaned : null;
}

export function offsetLoop(loop: Loop, distance: number): Loop | null {
  if (!Number.isFinite(distance)) return null;
  const pts = ensureCCW(cleanLoop(loop, 1e-7));
  if (pts.length < 3) return null;
  if (Math.abs(distance) < 1e-9) return pts;
  const n = pts.length;
  const out: Loop = [];
  const limit = Math.max(0.25, Math.abs(distance) * 4);
  for (let i = 0; i < n; i++) {
    const prev = pts[(i + n - 1) % n];
    const cur = pts[i];
    const next = pts[(i + 1) % n];
    const n0 = outwardNormal(prev, cur);
    const n1 = outwardNormal(cur, next);
    let bx = n0[0] + n1[0];
    let by = n0[1] + n1[1];
    const bl = Math.hypot(bx, by);
    if (bl < 1e-9) {
      out.push([cur[0] + n1[0] * distance, cur[1] + n1[1] * distance]);
      continue;
    }
    bx /= bl;
    by /= bl;
    const denom = bx * n1[0] + by * n1[1];
    let mag = Math.abs(denom) < 1e-4 ? Math.sign(distance || 1) * limit : distance / denom;
    if (Math.abs(mag) > limit) mag = Math.sign(mag) * limit;
    out.push([cur[0] + bx * mag, cur[1] + by * mag]);
  }
  return out.length >= 3 ? out : null;
}

export function pointSegDistance(p: Pt, a: Pt, b: Pt): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-16) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

/** True when non-adjacent edges cross. A chamfer mouth that does this is dropped. */
export function loopSelfIntersects(loop: Loop): boolean {
  const n = loop.length;
  if (n < 4) return false;
  const cross = (a: Pt, b: Pt, c: Pt, d: Pt) => {
    const r = (p: Pt, q: Pt, s: Pt) => (q[0] - p[0]) * (s[1] - p[1]) - (q[1] - p[1]) * (s[0] - p[0]);
    const d1 = r(c, d, a);
    const d2 = r(c, d, b);
    const d3 = r(a, b, c);
    const d4 = r(a, b, d);
    return ((d1 > 1e-9 && d2 < -1e-9) || (d1 < -1e-9 && d2 > 1e-9)) && ((d3 > 1e-9 && d4 < -1e-9) || (d3 < -1e-9 && d4 > 1e-9));
  };
  for (let i = 0; i < n; i++) {
    const a = loop[i];
    const b = loop[(i + 1) % n];
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      if (cross(a, b, loop[j], loop[(j + 1) % n])) return true;
    }
  }
  return false;
}
