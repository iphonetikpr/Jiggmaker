import { DEFAULTS, OBJECT_COLORS } from "../constants";
import type { HolesMode, JobObject, Loop, PreparedObject, StlMesh } from "../types";
import {
  classifyContours,
  cleanLoop,
  ensureCCW,
  inflatedRect,
  offsetLoopRound,
  originLoops,
  pointSegDistance,
  polyArea,
  translateLoop,
} from "./geom";
import type { Pt } from "../types";
import { clipToDepth, loopsArea, projectStl, silhouetteLoops, type Projected } from "./project";
import { parseSTL } from "./stl";

export interface PrepareOpts {
  pocketDepth: number;
}

function inFrame(loops: Loop[], ox: number, oy: number): Loop[] {
  return loops.map((l) => translateLoop(l, -ox, -oy));
}

/**
 * Pocket loops in the full-part frame. The pocket is the union of every
 * cross-section from the contact face up to the pocket depth (widest outline
 * in that band). Feet and ribs stay small slots; a section that widens inside
 * the band enlarges the slot so the part can seat. The part bbox stays the
 * layout footprint.
 */
function frameOf(loops: Loop[], ox: number, oy: number): Loop[] {
  return inFrame(loops, ox, oy);
}

type Seg = { a: Pt; b: Pt };

function solidAt(proj: Projected, x: number, y: number): boolean {
  for (const t of proj.tris) {
    const ax = t[0][0],
      ay = t[0][1],
      bx = t[1][0],
      by = t[1][1],
      cx = t[2][0],
      cy = t[2][1];
    const v0x = cx - ax,
      v0y = cy - ay,
      v1x = bx - ax,
      v1y = by - ay,
      v2x = x - ax,
      v2y = y - ay;
    const dot00 = v0x * v0x + v0y * v0y;
    const dot01 = v0x * v1x + v0y * v1y;
    const dot02 = v0x * v2x + v0y * v2y;
    const dot11 = v1x * v1x + v1y * v1y;
    const dot12 = v1x * v2x + v1y * v2y;
    const den = dot00 * dot11 - dot01 * dot01;
    if (Math.abs(den) < 1e-14) continue;
    const u = (dot11 * dot02 - dot01 * dot12) / den;
    const v = (dot00 * dot12 - dot01 * dot02) / den;
    if (u >= -1e-8 && v >= -1e-8 && u + v <= 1 + 1e-8) return true;
  }
  return false;
}

function locallyOpen(proj: Projected, p: Pt, a: Pt, b: Pt): boolean {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  const nx = -(b[1] - a[1]) / len;
  const ny = (b[0] - a[0]) / len;
  const eps = 2e-3;
  return solidAt(proj, p[0] + nx * eps, p[1] + ny * eps) !== solidAt(proj, p[0] - nx * eps, p[1] - ny * eps);
}

/** Keep only the spans of a triangle edge that are actually on the silhouette. */
function openSpans(proj: Projected, a: Pt, b: Pt): Seg[] {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (len < 1e-6) return [];
  const n = Math.max(2, Math.ceil(len / 0.25));
  const spans: Seg[] = [];
  let start: Pt | null = null;
  let prev: Pt | null = null;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const p: Pt = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    const open = locallyOpen(proj, p, a, b);
    if (open && !start) start = p;
    if (!open && start && prev) {
      spans.push({ a: start, b: prev });
      start = null;
    }
    if (open) prev = p;
  }
  if (start && prev && Math.hypot(prev[0] - start[0], prev[1] - start[1]) > 1e-4) spans.push({ a: start, b: prev });
  return spans;
}

function boundaryEdges(proj: Projected): Seg[] {
  const out: Seg[] = [];
  const seen = new Set<string>();
  for (const t of proj.tris) {
    for (let i = 0; i < 3; i++) {
      for (const span of openSpans(proj, t[i], t[(i + 1) % 3])) {
        const k0 = `${Math.round(span.a[0] * 1e3)},${Math.round(span.a[1] * 1e3)}`;
        const k1 = `${Math.round(span.b[0] * 1e3)},${Math.round(span.b[1] * 1e3)}`;
        const key = k0 < k1 ? `${k0}|${k1}` : `${k1}|${k0}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(span);
      }
    }
  }
  return out;
}

function closestOnSeg(p: Pt, a: Pt, b: Pt): { q: Pt; d: number; t: number } {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  let t = len2 < 1e-12 ? 0 : ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const q: Pt = [a[0] + t * dx, a[1] + t * dy];
  return { q, d: Math.hypot(p[0] - q[0], p[1] - q[1]), t };
}

function nearPt(a: Pt, b: Pt, tol = 0.02): boolean {
  return Math.hypot(a[0] - b[0], a[1] - b[1]) <= tol;
}

function edgesOf(p: Pt, edges: Seg[]): number[] {
  const ids: number[] = [];
  for (let i = 0; i < edges.length; i++) {
    if (pointSegDistance(p, edges[i].a, edges[i].b) <= 0.03) ids.push(i);
  }
  return ids;
}

function segmentCrossing(e: Seg, f: Seg): Pt | null {
  const d1: Pt = [e.b[0] - e.a[0], e.b[1] - e.a[1]];
  const d2: Pt = [f.b[0] - f.a[0], f.b[1] - f.a[1]];
  const den = d1[0] * d2[1] - d1[1] * d2[0];
  if (Math.abs(den) < 1e-12) return null;
  const t = ((f.a[0] - e.a[0]) * d2[1] - (f.a[1] - e.a[1]) * d2[0]) / den;
  const u = ((f.a[0] - e.a[0]) * d1[1] - (f.a[1] - e.a[1]) * d1[0]) / den;
  if (t < -0.02 || t > 1.02 || u < -0.02 || u > 1.02) return null;
  return [e.a[0] + t * d1[0], e.a[1] + t * d1[1]];
}

function sharedEnd(e: Seg, f: Seg): Pt | null {
  if (nearPt(e.a, f.a) || nearPt(e.a, f.b)) return e.a;
  if (nearPt(e.b, f.a) || nearPt(e.b, f.b)) return e.b;
  return null;
}

/** Pull a raster contour onto the true silhouette, and put back corners the trace cut off. */
function boundaryCorners(edges: Seg[]): Pt[] {
  const pts: Pt[] = [];
  for (let i = 0; i < edges.length; i++) {
    for (let j = i + 1; j < edges.length; j++) {
      const hit = sharedEnd(edges[i], edges[j]) ?? segmentCrossing(edges[i], edges[j]);
      if (hit) pts.push(hit);
    }
  }
  return pts;
}

function alignLoop(loop: Loop, edges: Seg[]): Loop {
  const corners = boundaryCorners(edges);
  const snapped = loop.map((p) => {
    let vertex: Pt | null = null;
    let vertexD = 0.06;
    for (const c of corners) {
      const d = Math.hypot(p[0] - c[0], p[1] - c[1]);
      if (d < vertexD) {
        vertex = c;
        vertexD = d;
      }
    }
    if (vertex) return vertex;
    let best = p;
    let bestD = 0.35;
    for (const e of edges) {
      for (const v of [e.a, e.b]) {
        const d = Math.hypot(p[0] - v[0], p[1] - v[1]);
        if (d < vertexD) {
          vertex = v;
          vertexD = d;
        }
      }
      const hit = closestOnSeg(p, e.a, e.b);
      if (hit.d < bestD) {
        best = hit.q;
        bestD = hit.d;
      }
    }
    return vertex ?? best;
  });
  const out: Loop = [];
  for (let i = 0; i < snapped.length; i++) {
    const a = snapped[i];
    const b = snapped[(i + 1) % snapped.length];
    out.push(a);
    const eas = edgesOf(a, edges);
    const ebs = edgesOf(b, edges);
    let corner: Pt | null = null;
    let via = Infinity;
    for (const ea of eas) {
      for (const eb of ebs) {
        if (ea === eb) continue;
        const hit = sharedEnd(edges[ea], edges[eb]) ?? segmentCrossing(edges[ea], edges[eb]);
        if (!hit || nearPt(hit, a, 0.01) || nearPt(hit, b, 0.01)) continue;
        const path = Math.hypot(hit[0] - a[0], hit[1] - a[1]) + Math.hypot(b[0] - hit[0], b[1] - hit[1]);
        if (path < via) {
          corner = hit;
          via = path;
        }
      }
    }
    const direct = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (corner && via <= direct + 0.75 && !nearPt(a, corner, 0.01) && !nearPt(b, corner, 0.01)) out.push(corner);
  }
  return dropNearlyCollinear(cleanLoop(out, 1e-4), 0.01);
}

/** Drop vertices that sit on the chord between their neighbors, so a snapped edge becomes one segment. */
function dropNearlyCollinear(loop: Loop, tol: number): Loop {
  const pts = loop.slice();
  let changed = true;
  while (changed && pts.length >= 4) {
    changed = false;
    for (let i = 0; i < pts.length; ) {
      const a = pts[(i + pts.length - 1) % pts.length];
      const b = pts[i];
      const c = pts[(i + 1) % pts.length];
      if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 1e-6) {
        pts.splice(i, 1);
        changed = true;
        continue;
      }
      const dot = (b[0] - a[0]) * (c[0] - b[0]) + (b[1] - a[1]) * (c[1] - b[1]);
      if (dot > 0 && pointSegDistance(b, a, c) <= tol) {
        pts.splice(i, 1);
        changed = true;
        continue;
      }
      i++;
    }
  }
  return pts;
}

function offsetSigned(loop: Loop, distance: number): Loop | null {
  const moved = offsetLoopRound(ensureCCW(loop), distance);
  if (!moved || moved.length < 3) return null;
  return polyArea(loop) < 0 ? moved.slice().reverse() : moved;
}

/**
 * One trace of the part, snapped to the true silhouette, then grown with round
 * corner joins. The template stores that same trace, so it is not a second,
 * shifted raster.
 */
function alignedSilhouette(proj: Projected, clearance: number): { art: Loop[]; pocket: Loop[] } | null {
  const pixel = clearance > 0 ? Math.min(0.05, clearance / 3) : 0.05;
  const raw = silhouetteLoops(proj, 0, pixel, Math.min(0.01, pixel * 0.2));
  if (!raw.length) return null;
  const edges = boundaryEdges(proj);
  if (!edges.length) return null;
  const art = raw.map((loop) => alignLoop(loop, edges)).filter((loop) => loop.length >= 3);
  if (!art.length) return null;
  if (clearance <= 1e-9) return { art, pocket: art };
  const split = classifyContours(art);
  const pocket: Loop[] = [];
  for (const loop of split.outers) {
    const grown = offsetSigned(loop, clearance);
    if (!grown) return null;
    pocket.push(grown);
  }
  for (const loop of split.holes) {
    const shrunk = offsetSigned(loop, -clearance);
    if (!shrunk) return null;
    pocket.push(shrunk);
  }
  return { art, pocket };
}

function seatLoops(proj: Projected, mode: JobObject["mode"], clearance: number, pocketDepth: number) {
  const aligned = mode === "silhouette" ? alignedSilhouette(proj, clearance) : null;
  const fullClear = aligned
    ? aligned.pocket
    : mode === "rectangle"
      ? inflatedRect(proj.bbox, clearance)
      : silhouetteLoops(proj, clearance, clearance > 0 ? clearance / 3 : undefined);
  const fullArt = aligned ? aligned.art : mode === "rectangle" ? inflatedRect(proj.bbox, 0) : silhouetteLoops(proj, 0);
  const clearClass = classifyContours(fullClear);
  const artClass = classifyContours(fullArt);
  const fallback = clearClass.outers.length ? clearClass.outers : fullClear.length ? fullClear : inflatedRect(proj.bbox, clearance);
  const centered = originLoops(fallback);
  const artSrc = artClass.outers.length ? artClass.outers : fullArt.length ? fullArt : centered.loops;
  const art = originLoops(artSrc);
  let loops = centered.loops;
  let holes = frameOf(clearClass.holes, centered.ox, centered.oy);
  let artLoops = art.loops.map((l) => translateLoop(l, art.ox - centered.ox, art.oy - centered.oy));
  let artHoles = frameOf(artClass.holes, centered.ox, centered.oy);

  const depth = pocketDepth;
  if (mode === "silhouette" && depth > 0 && depth < proj.partHeight - 0.05) {
    const band = clipToDepth(proj, depth);
    if (band.tris.length) {
      const bandArt = silhouetteLoops(band, 0);
      const fullA = loopsArea(fullArt.length ? fullArt : fallback);
      const bandA = loopsArea(bandArt);
      if (bandArt.length && fullA > 0 && bandA < 0.97 * fullA) {
        const slotClear = Math.max(clearance, DEFAULTS.slotClearance);
        // A plate-sized grid is coarser than 0.2 mm, which would swallow the clearance.
        const bandPocket = silhouetteLoops(band, slotClear, slotClear / 2);
        const pockets = bandPocket.length ? bandPocket : bandArt;
        const pocketClass = classifyContours(pockets);
        const bandArtClass = classifyContours(bandArt);
        const outers = pocketClass.outers.length ? pocketClass.outers : pockets;
        loops = frameOf(outers, centered.ox, centered.oy);
        holes = frameOf(pocketClass.holes, centered.ox, centered.oy);
        artLoops = frameOf(bandArtClass.outers.length ? bandArtClass.outers : bandArt, centered.ox, centered.oy);
        artHoles = frameOf(bandArtClass.holes, centered.ox, centered.oy);
      }
    }
  }

  return { loops, holes, artLoops, artHoles, centered };
}

const stlCache = new WeakMap<ArrayBuffer, StlMesh>();

export function meshFromBytes(buf: ArrayBuffer): StlMesh {
  let m = stlCache.get(buf);
  if (!m) {
    m = parseSTL(buf);
    stlCache.set(buf, m);
  }
  return m;
}

export function prepareObject(
  obj: JobObject,
  stlBytes: ArrayBuffer | null,
  index: number,
  opts?: PrepareOpts,
): PreparedObject {
  const letter = String.fromCharCode(65 + index);
  const color = OBJECT_COLORS[index % OBJECT_COLORS.length];
  const clearance = obj.clear;

  if (stlBytes && obj.stlName) {
    const mesh = meshFromBytes(stlBytes);
    let proj = projectStl(mesh, obj.up, obj.rot, obj.mirror);
    if (obj.auto) {
      const angles = [0, 15, 30, 45, 60, 75, 90];
      let best = obj.rot;
      let bestA = (proj.bbox[2] - proj.bbox[0]) * (proj.bbox[3] - proj.bbox[1]);
      for (const extra of angles) {
        const p = projectStl(mesh, obj.up, obj.rot + extra, obj.mirror);
        const a = (p.bbox[2] - p.bbox[0]) * (p.bbox[3] - p.bbox[1]);
        if (a < bestA - 1e-6) {
          bestA = a;
          best = obj.rot + extra;
          proj = p;
        }
      }
      if (best !== obj.rot) proj = projectStl(mesh, obj.up, best, obj.mirror);
    }

    const seated = seatLoops(proj, obj.mode, clearance, opts?.pocketDepth ?? DEFAULTS.pocketDepth);
    const loops = seated.loops;
    const centered = seated.centered;
    const artLoops = seated.artLoops;

    return {
      id: obj.id,
      name: obj.name || obj.stlName || letter,
      count: Math.max(1, obj.count | 0),
      letter,
      color,
      loops,
      holes: seated.holes,
      artLoops,
      artHoles: seated.artHoles,
      holesMode: obj.holes as HolesMode,
      w: centered.w,
      h: centered.h,
      partHeight: proj.partHeight,
    };
  }

  const w = Math.max(0.5, obj.rectW);
  const h = Math.max(0.5, obj.rectH);
  const loops = inflatedRect([0, 0, w, h], clearance);
  const centered = originLoops(loops);
  const art = originLoops(inflatedRect([0, 0, w, h], 0));
  const artLoops = art.loops.map((l) => translateLoop(l, art.ox - centered.ox, art.oy - centered.oy));

  return {
    id: obj.id,
    name: obj.name || "rect",
    count: Math.max(1, obj.count | 0),
    letter,
    color,
    loops: centered.loops,
    holes: [],
    artLoops,
    artHoles: [],
    holesMode: obj.holes as HolesMode,
    w: centered.w,
    h: centered.h,
    partHeight: 8,
  };
}
