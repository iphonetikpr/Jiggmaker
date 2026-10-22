import { describe, expect, it } from "vitest";
import {
  FINGER_NOTCH_DIA,
  FINGER_NOTCH_MIN_WALL,
  LEAD_IN_MM,
  LEAD_IN_NARROW_BELOW,
  LEAD_IN_NARROW_MM,
} from "../constants";
import { bboxOf } from "./geom";
import { defaultSettings, newObject } from "./history";
import { generateJig } from "./generate";
import { meshNonManifoldEdges } from "./mesh";
import type { JobObject, JobSettings, Tri } from "../types";

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

function innerSpan(tris: Tri[], z: number, plateW: number, plateH: number) {
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

describe("finger notch and lead-in", () => {
  it("uses the fixed notch and chamfer sizes", () => {
    expect(FINGER_NOTCH_DIA).toBe(14);
    expect(FINGER_NOTCH_MIN_WALL).toBe(1.5);
    expect(LEAD_IN_MM).toBe(0.6);
    expect(LEAD_IN_NARROW_MM).toBe(0.3);
    expect(LEAD_IN_NARROW_BELOW).toBe(4);
  });

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
