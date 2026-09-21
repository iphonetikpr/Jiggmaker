import { PAINT_SAFE_COLOR, PAINT_SAFE_DASH } from "../constants";
import type { Entity, JobSettings, Loop, PlacedPiece, Pt } from "../types";
import { bboxOf, cleanLoop, ensureCCW, rectLoop } from "./geom";

export function templateOuterLoops(piece: Pick<PlacedPiece, "art" | "loops">): Loop[] {
  return piece.art.length ? piece.art : piece.loops;
}

function lineIntersect(a1: Pt, a2: Pt, b1: Pt, b2: Pt): Pt | null {
  const dax = a2[0] - a1[0];
  const day = a2[1] - a1[1];
  const dbx = b2[0] - b1[0];
  const dby = b2[1] - b1[1];
  const det = dax * dby - day * dbx;
  if (Math.abs(det) < 1e-12) return null;
  const t = ((b1[0] - a1[0]) * dby - (b1[1] - a1[1]) * dbx) / det;
  return [a1[0] + t * dax, a1[1] + t * day];
}

/** Inset a closed loop by `d` mm per side (inward). Null if the shape collapses. */
export function insetLoop(loop: Loop, d: number): Loop | null {
  if (d <= 0) return loop.length >= 3 ? loop.slice() : null;
  const pts = ensureCCW(cleanLoop(loop, 1e-9));
  if (pts.length < 3) return null;
  const box = bboxOf([pts]);
  if (box.w <= 2 * d + 0.5 || box.h <= 2 * d + 0.5) return null;

  const n = pts.length;
  const edges: Array<{ a: Pt; b: Pt }> = [];
  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len = Math.hypot(dx, dy);
    if (len < 1e-12) continue;
    const nx = -dy / len;
    const ny = dx / len;
    edges.push({
      a: [a[0] + nx * d, a[1] + ny * d],
      b: [b[0] + nx * d, b[1] + ny * d],
    });
  }
  if (edges.length < 3) return null;

  const out: Loop = [];
  for (let i = 0; i < edges.length; i++) {
    const prev = edges[(i + edges.length - 1) % edges.length];
    const cur = edges[i];
    const hit = lineIntersect(prev.a, prev.b, cur.a, cur.b);
    if (!hit) continue;
    out.push(hit);
  }
  const cleaned = cleanLoop(out, 1e-6);
  if (cleaned.length < 3) return null;
  const inner = bboxOf([cleaned]);
  if (inner.w < 0.5 || inner.h < 0.5) return null;
  return cleaned;
}

export function paintSafeLoops(outer: Loop[], settings: JobSettings): Loop[] {
  if (!settings.paintSafe) return [];
  if (!outer.length) return [];
  if (settings.paintSafeMode === "fixed") {
    const b = bboxOf(outer);
    const w = Math.max(0.5, settings.paintSafeW);
    const h = Math.max(0.5, settings.paintSafeH);
    const x = b.minX + (b.w - w) / 2;
    const y = b.minY + (b.h - h) / 2;
    return [rectLoop(w, h, x, y)];
  }
  const d = Math.max(0, settings.paintSafeInset);
  if (d <= 0) return [];
  const out: Loop[] = [];
  for (const loop of outer) {
    const inset = insetLoop(loop, d);
    if (inset) out.push(inset);
  }
  return out;
}

export function paintSafeGuideEntity(loop: Loop): Entity {
  return {
    layer: "GUIDE",
    points: loop,
    closed: true,
    strokeWidth: 0.25,
    color: PAINT_SAFE_COLOR,
    dash: [...PAINT_SAFE_DASH],
  };
}

export function isPaintSafeGuide(e: Entity): boolean {
  return e.layer === "GUIDE" && !!e.closed && !!e.dash?.length;
}
