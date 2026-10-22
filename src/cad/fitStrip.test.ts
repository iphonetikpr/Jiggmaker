import { describe, expect, it } from "vitest";
import { FIT_CLEARANCE, TEST_STRIP } from "../constants";
import { bboxOf } from "./geom";
import { newObject } from "./history";
import { meshBBox, meshNonManifoldEdges } from "./mesh";
import { buildTestStrip, fitLabel } from "./testStrip";
import type { JobObject } from "../types";

function rect(w: number, h: number, patch: Partial<JobObject> = {}): JobObject {
  const obj = newObject(0);
  obj.rectW = w;
  obj.rectH = h;
  obj.mode = "rectangle";
  obj.name = "pieza";
  return { ...obj, ...patch };
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
