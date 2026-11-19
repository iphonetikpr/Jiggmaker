import { describe, expect, it } from "vitest";
import { PICK_OUT_SIDE_MM, SPLIT_DOWEL_DIA, SPLIT_HOLE_DIA, SPLIT_OVERLAP } from "../constants";
import { toDXF } from "./dxf";
import { generateJig } from "./generate";
import { bboxOf, pointInPoly, rectLoop } from "./geom";
import { defaultSettings, newObject } from "./history";
import { meshSingleIncidenceEdges } from "./mesh";
import { buildSplitMeshes, dowelPocketClearance, dowelSitesFor } from "./split";
import { makeLStl, makeRingStl } from "./stl";
import { wallBlockers } from "./walls";
import { toSVG } from "./svg";
import type { HolesMode, JobObject, JobSettings, Tri } from "../types";

function rect(w = 50, h = 30, patch: Partial<JobObject> = {}): JobObject {
  const obj = newObject(0);
  obj.name = "rect";
  obj.mode = "rectangle";
  obj.rectW = w;
  obj.rectH = h;
  obj.count = 1;
  return { ...obj, ...patch, mode: patch.mode ?? "rectangle", rectW: w, rectH: h };
}

function settings(patch: Partial<JobSettings> = {}): JobSettings {
  return { ...defaultSettings(), scaleComp: false, ...patch };
}

function cuts(svg: string): number {
  return (svg.match(/data-layer="CUT"/g) || []).length;
}

function pointInTri(x: number, y: number, t: Tri): boolean {
  const ax = t[0],
    ay = t[1],
    bx = t[3],
    by = t[4],
    cx = t[6],
    cy = t[7];
  const sign = (px: number, py: number, qx: number, qy: number, rx: number, ry: number) =>
    (px - rx) * (qy - ry) - (qx - rx) * (py - ry);
  const d1 = sign(x, y, ax, ay, bx, by);
  const d2 = sign(x, y, bx, by, cx, cy);
  const d3 = sign(x, y, cx, cy, ax, ay);
  const neg = d1 < -1e-8 || d2 < -1e-8 || d3 < -1e-8;
  const pos = d1 > 1e-8 || d2 > 1e-8 || d3 > 1e-8;
  return !(neg && pos);
}

function covered(tris: Tri[], x: number, y: number, z: number): boolean {
  return tris.some((t) => {
    if (Math.abs(t[2] - z) > 0.08 || Math.abs(t[5] - z) > 0.08 || Math.abs(t[8] - z) > 0.08) return false;
    return pointInTri(x, y, t);
  });
}

describe("geometry audit", () => {
  it("exports a closed mesh for a basic rectangle and rejects zero margin", () => {
    const basic = generateJig([rect()], {}, settings(), {});
    expect(basic.fits).toBe(true);
    expect(basic.blockers).toEqual([]);
    expect(meshSingleIncidenceEdges(basic.mesh)).toBe(0);

    const flush = generateJig([rect()], {}, settings({ marginX: 0, marginY: 0 }), {});
    expect(flush.blockers.some((line) => line.includes("mínimo 2.75 mm") && line.includes("Sube el margen a 3 mm"))).toBe(true);
    expect(meshSingleIncidenceEdges(flush.mesh)).toBeGreaterThan(0);
    expect(flush.blockers.some((line) => /aristas abiertas/.test(line))).toBe(true);
  });

  it("puts the pick-out circle on the base sheet only when it fits", () => {
    const off = generateJig([rect()], {}, settings({ pickOut: false }), {});
    const on = generateJig([rect()], {}, settings({ pickOut: true }), {});
    const baseOff = toSVG(off.jig.w, off.jig.h, off.laser.baseEntities);
    const baseOn = toSVG(on.jig.w, on.jig.h, on.laser.baseEntities);
    const pocketOn = toSVG(on.jig.w, on.jig.h, on.laser.pocketEntities);
    const pocketOff = toSVG(off.jig.w, off.jig.h, off.laser.pocketEntities);
    expect(baseOff).not.toContain("<circle");
    expect(pocketOff).not.toContain("<circle");
    expect(pocketOn).not.toContain("<circle");
    expect(baseOn).toContain("<circle");
    expect(baseOn).toContain('r="4"');
    expect(baseOn).toContain('data-layer="CUT"');
    expect(toDXF(on.laser.baseEntities)).toContain("CIRCLE");
    expect(toDXF(on.laser.baseEntities)).toContain("\n40\n4\n");
    expect(toDXF(on.laser.pocketEntities)).not.toContain("CIRCLE");
    expect(toDXF(off.laser.baseEntities)).not.toContain("CIRCLE");
    expect(meshSingleIncidenceEdges(on.mesh)).toBe(0);
    expect(on.blockers).toEqual([]);

    const tiny = generateJig([rect(10, 10)], {}, settings({ pickOut: true, pickDia: 8 }), {});
    expect(toSVG(tiny.jig.w, tiny.jig.h, tiny.laser.baseEntities)).not.toContain("<circle");
    expect(toDXF(tiny.laser.baseEntities)).not.toContain("CIRCLE");
    expect(tiny.notices).toContain(
      `El agujero de extracción Ø8 mm no cabe en A1 (hacen falta ${PICK_OUT_SIDE_MM} mm por lado). Se omite.`,
    );
    expect(tiny.blockers).toEqual([]);
  });

  it("moves a full-bed split off the pocket and closes both halves", () => {
    const r = generateJig([rect()], {}, settings({ footprint: "bed", splitPlate: true, maxPrintBed: 250 }), {});
    expect(r.splits).toHaveLength(2);
    expect(r.blockers).toEqual([]);
    const pocket = bboxOf(r.meshPockets[0].loops);
    for (const s of r.splits) {
      const through = s.x0 > pocket.minX + 0.2 && s.x0 < pocket.maxX - 0.2;
      expect(through).toBe(false);
      expect(s.x1 > pocket.minX + 0.2 && s.x1 < pocket.maxX - 0.2 && s.x1 < r.jig.w - 1e-6).toBe(false);
    }
    const pieces = buildSplitMeshes(r);
    expect(pieces).toHaveLength(2);
    for (const piece of pieces) {
      expect(meshSingleIncidenceEdges(piece.mesh)).toBe(0);
      expect(piece.split.x1 - piece.split.x0).toBeLessThanOrEqual(250 + 1e-6);
    }
    const loops = r.meshPockets.flatMap((p) => p.loops);
    let minWall = Infinity;
    for (const split of r.splits) {
      for (const site of dowelSitesFor(split, r)) {
        minWall = Math.min(minWall, dowelPocketClearance(site.axis, site.at, site.span, loops));
      }
    }
    expect(minWall).toBeGreaterThanOrEqual(2);
    expect(SPLIT_DOWEL_DIA).toBe(3);
    expect(SPLIT_HOLE_DIA).toBe(3.25);
    expect(SPLIT_OVERLAP).toBe(2.5);
  });

  it("blocks a split when every legal cut passes through a pocket", () => {
    const obj = rect(50, 30, { count: 12 });
    const r = generateJig([obj], {}, settings({ bed: "333x418", footprint: "bed", splitPlate: true, maxPrintBed: 250 }), {});
    expect(r.splits).toHaveLength(0);
    expect(r.blockers.some((line) => /no hay franja libre/.test(line))).toBe(true);
    expect(meshSingleIncidenceEdges(r.mesh)).toBe(0);
  });

  it("separates a ring's inner contour across the four hole modes", () => {
    const buf = makeRingStl();
    const modes: HolesMode[] = ["none", "template", "jig", "all"];
    const jobs = modes.map((holes) => {
      const obj = newObject(0);
      obj.name = "ring";
      obj.stlName = "ring";
      obj.mode = "silhouette";
      obj.holes = holes;
      obj.count = 1;
      obj.clear = 0.15;
      return generateJig([obj], { [obj.id]: buf }, settings(), {});
    });

    const [none, template, jig, all] = jobs;
    for (const r of jobs) {
      expect(r.blockers).toEqual([]);
      expect(meshSingleIncidenceEdges(r.mesh)).toBe(0);
      expect(r.placed[0].loops.length).toBeGreaterThan(0);
      expect(r.placed[0].holes.length).toBeGreaterThan(0);
    }

    const templateCuts = (r: (typeof jobs)[number]) =>
      r.template.entities.filter((e) => e.layer === "CUT" && e.closed && (e.points?.length || 0) >= 3);
    expect(templateCuts(none)).toHaveLength(1);
    expect(templateCuts(jig)).toHaveLength(1);
    expect(templateCuts(template).length).toBeGreaterThan(1);
    expect(templateCuts(all).length).toBeGreaterThan(1);

    const inner = (r: (typeof jobs)[number]) => {
      const loops = templateCuts(r).map((e) => bboxOf([e.points!]));
      return loops.some((b) => b.w < 16 && b.h < 16);
    };
    expect(inner(none)).toBe(false);
    expect(inner(jig)).toBe(false);
    expect(inner(template)).toBe(true);
    expect(inner(all)).toBe(true);

    const svg = (r: (typeof jobs)[number]) => toSVG(r.template.bed.w, r.template.bed.h, r.template.entities);
    expect(svg(none)).toBe(svg(jig));
    expect(svg(template)).toBe(svg(all));
    expect(svg(none)).not.toBe(svg(template));

    const centerOf = (r: (typeof jobs)[number]) => {
      const p = r.placed[0];
      return { x: p.cx + r.plateOffset.x, y: p.cy + r.plateOffset.y, z: r.solidH };
    };
    const noneC = centerOf(none);
    const jigC = centerOf(jig);
    expect(covered(none.mesh, noneC.x, noneC.y, noneC.z)).toBe(false);
    expect(covered(template.mesh, centerOf(template).x, centerOf(template).y, centerOf(template).z)).toBe(false);
    expect(covered(jig.mesh, jigC.x, jigC.y, jigC.z)).toBe(true);
    expect(covered(all.mesh, centerOf(all).x, centerOf(all).y, centerOf(all).z)).toBe(true);

    const hole = none.placed[0].holes[0];
    expect(pointInPoly([none.placed[0].cx, none.placed[0].cy], hole)).toBe(true);
    expect(cuts(svg(template))).toBeGreaterThan(cuts(svg(none)));
  });

  it("states the 2.75 mm wall minimum without rounding it up", () => {
    const lines = wallBlockers(
      [{ label: "A1", clearance: 0.15, leadIn: true, loops: [rectLoop(10, 10, 0, 0)] }],
      10,
      10,
    );
    expect(lines).toEqual([
      "Pared insuficiente: A1 (margen 0 mm, mínimo 2.75 mm). Sube el margen a 3 mm.",
    ]);
  });

  it("keeps silhouette clearance at corners and edges, against the true outline and the template", () => {
    const ring = measureClearance("ring", 0.15);
    const ell = measureClearance("ell", 0.15);
    const floor = 0.95 * 0.15;
    for (const stats of [ring.outerTrue, ring.outerTemplate, ring.innerTrue, ring.innerTemplate, ell.outerTrue, ell.outerTemplate]) {
      expect(stats.cornerSamples).toBeGreaterThan(0);
      expect(stats.edgeSamples).toBeGreaterThan(0);
      expect(stats.corner).toBeGreaterThanOrEqual(floor);
      expect(stats.edge).toBeGreaterThanOrEqual(floor);
    }
    expect(meshSingleIncidenceEdges(ring.mesh)).toBe(0);
    expect(meshSingleIncidenceEdges(ell.mesh)).toBe(0);
  });
});

type SampleStats = { corner: number; edge: number; cornerSamples: number; edgeSamples: number };

function sampleLoop(loop: [number, number][], step = 0.01): [number, number][] {
  const pts: [number, number][] = [];
  for (let i = 0; i < loop.length; i++) {
    const a = loop[i];
    const b = loop[(i + 1) % loop.length];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const n = Math.max(1, Math.ceil(len / step));
    for (let k = 0; k < n; k++) {
      const t = k / n;
      pts.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
  }
  return pts;
}

function nearestOnLoops(p: [number, number], loops: [number, number][][]): { dist: number; atVertex: boolean } {
  let dist = Infinity;
  let atVertex = false;
  for (const loop of loops) {
    for (let i = 0; i < loop.length; i++) {
      const a = loop[i];
      const b = loop[(i + 1) % loop.length];
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      const len2 = dx * dx + dy * dy;
      let t = len2 < 1e-12 ? 0 : ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2;
      t = Math.max(0, Math.min(1, t));
      const d = Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
      if (d < dist - 1e-9) {
        dist = d;
        atVertex = t <= 0.02 || t >= 0.98;
      }
    }
  }
  return { dist, atVertex };
}

function clearanceStats(pocket: [number, number][][], reference: [number, number][][]): SampleStats {
  let corner = Infinity;
  let edge = Infinity;
  let cornerSamples = 0;
  let edgeSamples = 0;
  for (const loop of pocket) {
    for (const p of sampleLoop(loop, 0.01)) {
      const hit = nearestOnLoops(p, reference);
      if (hit.atVertex) {
        cornerSamples++;
        if (hit.dist < corner) corner = hit.dist;
      } else {
        edgeSamples++;
        if (hit.dist < edge) edge = hit.dist;
      }
    }
  }
  return { corner, edge, cornerSamples, edgeSamples };
}

function measureClearance(kind: "ring" | "ell", clearance: number) {
  const buf = kind === "ring" ? makeRingStl() : makeLStl();
  const obj = newObject(0);
  obj.stlName = "part";
  obj.mode = "silhouette";
  obj.clear = clearance;
  obj.holes = "none";
  const result = generateJig([obj], { [obj.id]: buf }, settings({ marginX: 4, marginY: 4 }), {});
  const piece = result.placed[0];
  const shift = bedShift(piece.loops, clearance);
  const ringOuter: [number, number][] = [
    [0, 0],
    [30, 0],
    [30, 30],
    [0, 30],
  ].map(([x, y]) => [x + shift.x, y + shift.y]);
  const ringHole: [number, number][] = [
    [10, 10],
    [20, 10],
    [20, 20],
    [10, 20],
  ].map(([x, y]) => [x + shift.x, y + shift.y]);
  const ellOuter: [number, number][] = [
    [0, 0],
    [40, 0],
    [40, 15],
    [15, 15],
    [15, 30],
    [0, 30],
  ].map(([x, y]) => [x + shift.x, y + shift.y]);
  const trueOuter = kind === "ring" ? [ringOuter] : [ellOuter];
  const trueInner = kind === "ring" ? [ringHole] : [];
  const pocketOuter = piece.loops;
  const pocketInner = piece.holes;
  const templateOuter = piece.art.length ? piece.art : piece.loops;
  const templateInner = piece.artHoles.length ? piece.artHoles : piece.holes;
  return {
    outerTrue: clearanceStats(pocketOuter, trueOuter),
    outerTemplate: clearanceStats(pocketOuter, templateOuter),
    innerTrue: kind === "ring" ? clearanceStats(pocketInner, trueInner) : emptyStats(),
    innerTemplate: kind === "ring" ? clearanceStats(pocketInner, templateInner) : emptyStats(),
    mesh: result.mesh,
  };
}

function emptyStats(): SampleStats {
  return { corner: Infinity, edge: Infinity, cornerSamples: 1, edgeSamples: 1 };
}

function bedShift(loops: [number, number][][], clearance: number) {
  const box = bboxOf(loops);
  const trueMinX = 0;
  const trueMinY = 0;
  return { x: box.minX - (trueMinX - clearance), y: box.minY - (trueMinY - clearance) };
}
