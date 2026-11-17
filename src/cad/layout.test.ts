import { describe, expect, it } from "vitest";
import { generateJig } from "./generate";
import { bboxOf } from "./geom";
import { defaultSettings, newObject } from "./history";
import type { JobObject, JobSettings } from "../types";

function rect(w: number, h: number, patch: Partial<JobObject> = {}): JobObject {
  const obj = newObject(0);
  obj.name = patch.name || "rect";
  obj.mode = "rectangle";
  obj.rectW = w;
  obj.rectH = h;
  obj.count = 1;
  obj.leadIn = false;
  return { ...obj, ...patch, rectW: w, rectH: h, mode: "rectangle" };
}

function mini(patch: Partial<JobSettings> = {}): JobSettings {
  return { ...defaultSettings(), bed: "333x88", ...patch };
}

describe("layout integrity", () => {
  it("does not report fits when a part is too wide to place", () => {
    const a = rect(50, 30, { name: "A" });
    const b = rect(400, 30, { name: "B", id: "b" });
    const r = generateJig([a, b], {}, mini(), {});
    expect(r.fits).toBe(false);
    expect(r.objects[0].placed).toBe(1);
    expect(r.objects[1].letter).toBe("B");
    expect(r.objects[1].requested).toBe(1);
    expect(r.objects[1].placed).toBe(0);
    expect(r.totalUnits).toBe(1);
    expect(r.warn).toContain("Faltan: B ×1");
    expect(r.blockers.some((line) => line.includes("Faltan: B ×1"))).toBe(true);
    expect(r.placed.map((p) => p.label)).toEqual(["A1"]);
  });

  it("does not report fits when nothing can be placed, including margin 0", () => {
    const huge = rect(400, 30);
    const withMargin = generateJig([huge], {}, mini(), {});
    expect(withMargin.fits).toBe(false);
    expect(withMargin.totalUnits).toBe(0);
    expect(withMargin.warn).toContain("Faltan: A ×1");
    expect(withMargin.blockers.length).toBeGreaterThan(0);

    const flush = generateJig([huge], {}, mini({ marginX: 0, marginY: 0 }), {});
    expect(flush.fits).toBe(false);
    expect(flush.placed).toHaveLength(0);
    expect(flush.warn).toContain("Faltan: A ×1");
    expect(flush.blockers.length).toBeGreaterThan(0);
  });

  it("marks imported moves that stack two pockets", () => {
    const a = rect(50, 30, { count: 2 });
    const r = generateJig([a], {}, mini(), { A1: [140, 29], A2: [140, 29] });
    expect(r.placed).toHaveLength(2);
    expect(r.objects[0].placed).toBe(2);
    expect(r.fits).toBe(false);
    expect(r.warn).toMatch(/Solape: A1 y A2 \(21 mm\)/);
    expect(r.blockers.some((line) => /Solape: A1 y A2/.test(line))).toBe(true);

    const art = r.placed.map((p) => bboxOf(p.art));
    const overlap = Math.min(art[0].maxX, art[1].maxX) - Math.max(art[0].minX, art[1].minX);
    expect(overlap).toBeGreaterThan(20);
    expect(overlap).toBeLessThan(22);
  });

  it("keeps a separated pair as fits and allows a modest drag", () => {
    const a = rect(50, 30, { count: 2 });
    const base = generateJig([a], {}, mini(), {});
    expect(base.fits).toBe(true);
    expect(base.blockers).toEqual([]);
    expect(base.totalUnits).toBe(2);

    const label = base.placed[0].label;
    const moved = generateJig([a], {}, mini(), { [label]: [-6, 2] });
    expect(moved.fits).toBe(true);
    expect(moved.blockers).toEqual([]);
    expect(moved.placed[0].cx).toBeCloseTo(base.placed[0].cx - 6, 5);
  });

  it("rejects a drag that pushes a pocket through the margin", () => {
    const a = rect(50, 30);
    const base = generateJig([a], {}, mini(), {});
    expect(base.fits).toBe(true);
    const shoved = generateJig([a], {}, mini(), { A1: [400, 0] });
    expect(shoved.fits).toBe(false);
    expect(shoved.warn).toMatch(/Fuera de margen: A1/);
    expect(shoved.blockers.length).toBeGreaterThan(0);
  });
});
