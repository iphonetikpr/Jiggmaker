import { describe, expect, it } from "vitest";
import {
  FIT_CLEARANCE,
  FINGER_NOTCH_DIA,
  FINGER_NOTCH_MIN_WALL,
  LEAD_IN_MM,
  LEAD_IN_NARROW_BELOW,
  LEAD_IN_NARROW_MM,
  TEST_STRIP,
} from "../constants";
import { bboxOf } from "./geom";
import { defaultSettings, newObject } from "./history";
import { generateJig } from "./generate";
import { meshBBox, meshNonManifoldEdges } from "./mesh";
import { buildTestStrip, fitLabel } from "./testStrip";
import type { JobObject, JobSettings } from "../types";

function rect(w: number, h: number, patch: Partial<JobObject> = {}): JobObject {
  const obj = newObject(0);
  obj.rectW = w;
  obj.rectH = h;
  obj.mode = "rectangle";
  obj.name = "pieza";
  return { ...obj, ...patch };
}

function job(objects: JobObject[], patch: Partial<JobSettings> = {}) {
  return generateJig(objects, {}, { ...defaultSettings(), scaleComp: false, center: false, ...patch }, {});
}

function innerSpan(tris: JobSettings extends never ? never : ReturnType<typeof job>["mesh"], z: number, plateW: number, plateH: number) {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity,
    n = 0;
  for (const t of tris) {
    for (let i = 0; i < 9; i += 3) {
      const x = t[i],
        y = t[i + 1],
        vz = t[i + 2];
      if (Math.abs(vz - z) > 0.08) continue;
      if (x < 1 || y < 1 || x > plateW - 1 || y > plateH - 1) continue;
      n++;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY, n };
}

describe("fit clearance table", () => {
  it("keeps the material offsets in one table", () => {
    expect(FIT_CLEARANCE.pla).toEqual([0.15, 0.25, 0.35]);
    expect(FIT_CLEARANCE.petg).toEqual([0.2, 0.3, 0.4]);
    expect(FIT_CLEARANCE.resin).toEqual([0.05, 0.1, 0.15]);
    expect(fitLabel(0.15)).toBe(".15");
    expect(fitLabel(0.2)).toBe(".20");
    expect(fitLabel(0.05)).toBe(".05");
    expect(fitLabel(0.4)).toBe(".40");
    expect(TEST_STRIP).toMatchObject({ gap: 5, margin: 2, base: 2, cropAbove: 50, crop: 40, labelHeight: 4, labelDepth: 0.6 });
    expect(FINGER_NOTCH_DIA).toBe(14);
    expect(FINGER_NOTCH_MIN_WALL).toBe(1.5);
    expect(LEAD_IN_MM).toBe(0.6);
    expect(LEAD_IN_NARROW_MM).toBe(0.3);
    expect(LEAD_IN_NARROW_BELOW).toBe(4);
  });
});

describe("test strip", () => {
  it("exports three PLA pockets 5 mm apart with a 2 mm base and engraved labels", () => {
    const depth = 3;
    const strip = buildTestStrip(rect(20, 12), null, depth, "pla");
    expect(strip.cropped).toBe(false);
    expect(strip.labels).toEqual([".15", ".25", ".35"]);
    expect(strip.base).toBe(2);
    expect(strip.solidH).toBeCloseTo(2 + depth, 5);
    expect(strip.pockets).toHaveLength(3);
    expect(meshNonManifoldEdges(strip.mesh)).toBe(0);
    const box = meshBBox(strip.mesh);
    expect(box.minZ).toBeCloseTo(0, 5);
    expect(box.maxZ).toBeCloseTo(strip.solidH, 5);
    expect(box.maxX - box.minX).toBeCloseTo(strip.w, 3);
    expect(box.maxY - box.minY).toBeCloseTo(strip.h, 3);

    const widths = strip.pockets.map((p) => bboxOf(p.loops).w);
    expect(widths[0]).toBeCloseTo(20 + 2 * 0.15, 2);
    expect(widths[1]).toBeCloseTo(20 + 2 * 0.25, 2);
    expect(widths[2]).toBeCloseTo(20 + 2 * 0.35, 2);
    for (let i = 0; i < 2; i++) {
      const a = bboxOf(strip.pockets[i].loops);
      const b = bboxOf(strip.pockets[i + 1].loops);
      expect(b.minX - a.maxX).toBeCloseTo(TEST_STRIP.gap, 2);
    }
    for (const pocket of strip.pockets) {
      const hole = bboxOf(pocket.loops);
      const text = bboxOf(pocket.labelLoops);
      expect(text.h).toBeCloseTo(TEST_STRIP.labelHeight, 2);
      expect(hole.minY - text.maxY).toBeGreaterThan(TEST_STRIP.labelGap - 0.05);
    }
    const labelZ = strip.mesh.some((t) => [t[2], t[5], t[8]].some((z) => Math.abs(z - (strip.solidH - TEST_STRIP.labelDepth)) < 1e-3));
    expect(labelZ).toBe(true);
    expect(strip.w).toBeCloseTo(strip.pockets[2] ? bboxOf(strip.pockets[2].loops).maxX + TEST_STRIP.margin : 0, 2);
    expect(strip.h).toBeGreaterThan(TEST_STRIP.margin + TEST_STRIP.labelHeight + 12);
  });

  it("uses a 40 mm corner when the part's largest side exceeds 50 mm", () => {
    const strip = buildTestStrip(rect(80, 60), null, 4, "petg");
    expect(strip.cropped).toBe(true);
    expect(strip.labels).toEqual([".20", ".30", ".40"]);
    expect(strip.solidH).toBeCloseTo(6, 5);
    for (const pocket of strip.pockets) {
      const box = bboxOf(pocket.loops);
      expect(box.w).toBeCloseTo(TEST_STRIP.crop + 2 * pocket.clearance, 2);
      expect(box.h).toBeCloseTo(TEST_STRIP.crop + 2 * pocket.clearance, 2);
    }
    expect(meshNonManifoldEdges(strip.mesh)).toBe(0);
  });

  it("uses the resin offsets", () => {
    const strip = buildTestStrip(rect(16, 16), null, 3, "resin");
    expect(strip.clearances).toEqual([0.05, 0.1, 0.15]);
    expect(strip.labels).toEqual([".05", ".10", ".15"]);
    expect(bboxOf(strip.pockets[0].loops).w).toBeCloseTo(16 + 2 * 0.05, 2);
  });
});

describe("finger notch and lead-in", () => {
  it("chamfers the mouth by 0.6 mm and leaves the seat at the clearance", () => {
    const obj = rect(40, 20, { clear: 0.15, leadIn: true, notch: false });
    const r = job([obj], { baseThk: 2, pocketDepth: 3, footprint: "tight" });
    expect(r.meshPockets[0].leadIn).toBe(LEAD_IN_MM);
    const seat = bboxOf(r.meshPockets[0].loops);
    expect(seat.w).toBeCloseTo(40 + 2 * 0.15, 2);
    expect(meshNonManifoldEdges(r.mesh)).toBe(0);
    const top = innerSpan(r.mesh, r.solidH, r.jig.w, r.jig.h);
    const below = innerSpan(r.mesh, r.solidH - LEAD_IN_MM, r.jig.w, r.jig.h);
    expect(top.n).toBeGreaterThan(4);
    expect(below.n).toBeGreaterThan(4);
    expect(top.w).toBeGreaterThan(below.w + 0.7);
    expect(below.w).toBeCloseTo(seat.w, 1);
  });

  it("uses a 0.3 mm lead-in when the slot is narrower than 4 mm", () => {
    const obj = rect(3, 12, { clear: 0.1, leadIn: true });
    const r = job([obj], { footprint: "tight" });
    expect(Math.min(bboxOf(r.meshPockets[0].loops).w, bboxOf(r.meshPockets[0].loops).h)).toBeLessThan(4);
    expect(r.meshPockets[0].leadIn).toBe(LEAD_IN_NARROW_MM);
    expect(meshNonManifoldEdges(r.mesh)).toBe(0);
  });

  it("adds a Ø14 notch on the long side of a single pocket", () => {
    const plain = rect(50, 20, { notch: false, leadIn: false });
    const notched = rect(50, 20, { notch: true, leadIn: false });
    const before = job([plain], { footprint: "tight", marginX: 2, marginY: 2 });
    const after = job([notched], { footprint: "tight", marginX: 2, marginY: 2 });
    expect(after.notchWarn).toBeNull();
    const a = bboxOf(before.placed[0].loops);
    const b = bboxOf(after.placed[0].loops);
    const grown = Math.max(b.w - a.w, b.h - a.h);
    expect(grown).toBeCloseTo(FINGER_NOTCH_DIA / 2, 1);
    expect(after.jig.h + after.jig.w).toBeGreaterThan(before.jig.h + before.jig.w + 5);
    expect(meshNonManifoldEdges(after.mesh)).toBe(0);
    const both = job([rect(50, 20, { notch: true, leadIn: true })], { footprint: "tight", marginX: 2, marginY: 2 });
    expect(both.notchWarn).toBeNull();
    expect(both.meshPockets[0].leadIn).toBe(LEAD_IN_MM);
    expect(meshNonManifoldEdges(both.mesh)).toBe(0);
  });

  it("skips the notch when the wall to the neighbor would drop below 1.5 mm", () => {
    const make = (notch: boolean) => {
      const a = rect(12, 40, { notch, leadIn: false, count: 2, clear: 0.15 });
      return job([a], { spacingX: 5, footprint: "tight" });
    };
    const skipped = make(true);
    expect(skipped.notchWarn).toMatch(/1\.5/);
    expect(skipped.notchWarn).toMatch(/omitido/);
    const open = job([rect(12, 40, { notch: true, leadIn: false, count: 2, clear: 0.15 })], {
      spacingX: 30,
      footprint: "tight",
    });
    expect(open.notchWarn).toBeNull();
    expect(meshNonManifoldEdges(open.mesh)).toBe(0);
    expect(meshNonManifoldEdges(skipped.mesh)).toBe(0);
  });
});
