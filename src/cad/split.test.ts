import { describe, expect, it } from "vitest";
import { SPLIT_OVERLAP } from "../constants";
import { laserFiles, stlFiles } from "./export";
import { generateJig } from "./generate";
import { defaultSettings, newObject } from "./history";
import { meshBBox, meshNonManifoldEdges } from "./mesh";
import { buildSplitMeshes } from "./split";
import type { JobSettings } from "../types";

function job(patch: Partial<JobSettings> = {}) {
  const settings: JobSettings = { ...defaultSettings(), scaleComp: false, ...patch };
  const obj = newObject(0);
  obj.name = "coin";
  obj.count = 2;
  obj.rectW = 40;
  obj.rectH = 20;
  obj.mode = "rectangle";
  return generateJig([obj], {}, settings, {});
}

describe("PLA plate split", () => {
  it("unsplit Large export is still one solid plate", () => {
    const r = job({ bed: "333x418", splitPlate: false });
    expect(r.jig.w).toBe(333);
    expect(r.jig.h).toBe(418);
    expect(r.splits).toHaveLength(0);
    const files = stlFiles(r, "coin_Large_2up").filter((f) => f.name.endsWith(".stl") && !f.name.includes("_ascii"));
    expect(files).toHaveLength(1);
    expect(files[0].name).toBe("coin_Large_2up.stl");
    const b = meshBBox(r.mesh);
    expect(b.maxX - b.minX).toBeCloseTo(333, 1);
    expect(b.maxY - b.minY).toBeCloseTo(418, 1);
  });

  it("Large + split yields N STLs on the 418 axis, each long side ≤250+overlap", () => {
    const r = job({ bed: "333x418", splitPlate: true, maxPrintBed: 250 });
    expect(r.splits.length).toBeGreaterThanOrEqual(2);
    expect(r.splits.some((s) => s.ny >= 2)).toBe(true);
    const pieces = buildSplitMeshes(r);
    expect(pieces).toHaveLength(r.splits.length);
    for (const p of pieces) {
      const b = meshBBox(p.mesh);
      const dx = b.maxX - b.minX;
      const dy = b.maxY - b.minY;
      expect(Math.max(dx, dy)).toBeLessThanOrEqual(250 + SPLIT_OVERLAP + 0.05);
      expect(p.split.y1 - p.split.y0).toBeLessThanOrEqual(250 + 1e-6);
    }
    const names = stlFiles(r, "coin_Large_2up").map((f) => f.name);
    expect(names.some((n) => n.includes("_split1of") && n.endsWith(".stl"))).toBe(true);
    expect(names.filter((n) => n.endsWith(".stl") && !n.includes("_ascii"))).toHaveLength(r.splits.length);
  });

  it("Mini + split cuts the 333 axis", () => {
    const r = job({ bed: "333x88", splitPlate: true, maxPrintBed: 250 });
    expect(r.splits.length).toBeGreaterThanOrEqual(2);
    expect(r.splits.every((s) => s.nx >= 2)).toBe(true);
    expect(r.splits.every((s) => s.y0 === 0 && s.y1 === 88)).toBe(true);
    const pieces = buildSplitMeshes(r);
    for (const p of pieces) {
      const b = meshBBox(p.mesh);
      expect(b.maxX - b.minX).toBeLessThanOrEqual(250 + SPLIT_OVERLAP + 0.05);
    }
  });

  it("does not split laser DXF/SVG", () => {
    const r = job({ bed: "333x418", splitPlate: true });
    const files = laserFiles(r, "coin_Large_2up");
    expect(files.every((f) => !f.name.includes("split"))).toBe(true);
    const svg = files.find((f) => f.name.endsWith("_POCKET.svg"));
    expect(String(svg?.data)).toContain('viewBox="0 0 333 418"');
  });

  it("applies the same scaleComp to every segment", () => {
    const r = job({ bed: "333x418", splitPlate: true, scaleComp: true });
    expect(r.meshXform.s).toBeCloseTo(1.003, 6);
    const pieces = buildSplitMeshes(r);
    const zs = pieces.map((p) => meshBBox(p.mesh).maxZ);
    for (const z of zs) expect(z).toBeCloseTo(zs[0], 5);
  });

  it("split pieces stay close to watertight", () => {
    const r = job({ bed: "333x88", splitPlate: true, scaleComp: false });
    for (const p of buildSplitMeshes(r)) {
      expect(meshNonManifoldEdges(p.mesh)).toBeLessThan(80);
    }
  });
});
