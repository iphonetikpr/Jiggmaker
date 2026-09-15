import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { SPLIT_OVERLAP } from "../constants";
import {
  buildSplitZip,
  laserFiles,
  offersSplitZip,
  splitBinaryStls,
  splitZipName,
  stlFiles,
} from "./export";
import { generateJig } from "./generate";
import { pointInPoly } from "./geom";
import { defaultSettings, newObject } from "./history";
import { meshBBox, meshNonManifoldEdges } from "./mesh";
import { buildSplitMeshes, dowelSitesFor } from "./split";
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
    const unsplit = meshNonManifoldEdges(r.mesh);
    for (const p of buildSplitMeshes(r)) {
      const bad = meshNonManifoldEdges(p.mesh);
      expect(bad).toBeLessThanOrEqual(unsplit + 12);
    }
  });

  it("pairs male Ø3 dowels with female 3.25 holes on the same cut", () => {
    const r = job({ bed: "333x88", splitPlate: true, scaleComp: false });
    const left = r.splits.find((s) => s.ix === 0)!;
    const right = r.splits.find((s) => s.ix === 1)!;
    const male = dowelSitesFor(left, r).filter((d) => d.axis === "x" && d.role === "male");
    const female = dowelSitesFor(right, r).filter((d) => d.axis === "x" && d.role === "female");
    expect(male.length).toBeGreaterThanOrEqual(2);
    expect(female.map((d) => d.span.toFixed(3))).toEqual(male.map((d) => d.span.toFixed(3)));
    expect(male[0].at).toBeCloseTo(female[0].at, 6);
    expect(male[0].z).toBeCloseTo(r.solidH / 2, 6);
    const pieces = buildSplitMeshes(r);
    const leftMesh = pieces.find((p) => p.split.ix === 0)!.mesh;
    const b = meshBBox(leftMesh);
    expect(b.maxX).toBeGreaterThan(left.x1 + SPLIT_OVERLAP - 0.05);
  });

  it("does not place dowels through pockets", () => {
    const r = job({ bed: "333x88", splitPlate: true });
    for (const s of r.splits) {
      for (const d of dowelSitesFor(s, r)) {
        const x = d.axis === "x" ? d.at : d.span;
        const y = d.axis === "x" ? d.span : d.at;
        for (const p of r.meshPockets) {
          for (const loop of p.loops) {
            expect(pointInPoly([x, y], loop)).toBe(false);
          }
        }
      }
    }
  });

  it("Frame ON splits the 334 mm length and leaves laser full-plate", () => {
    const r = job({ bed: "333x88", useAdapter: true, splitPlate: true, maxPrintBed: 250 });
    expect(r.jig.w).toBe(334);
    expect(r.jig.h).toBe(90);
    expect(r.splits.length).toBeGreaterThanOrEqual(2);
    expect(r.splits.every((s) => s.nx >= 2)).toBe(true);
    const pieces = buildSplitMeshes(r);
    for (const p of pieces) {
      const b = meshBBox(p.mesh);
      expect(Math.max(b.maxX - b.minX, b.maxY - b.minY)).toBeLessThanOrEqual(250 + SPLIT_OVERLAP + 0.05);
    }
    const svg = laserFiles(r, "coin_MiniFrame_2up").find((f) => f.name.endsWith("_POCKET.svg"));
    expect(String(svg?.data)).toContain('viewBox="0 0 334 90"');
  });
});

describe("split STL ZIP", () => {
  it("is offered only when split yields N>1 pieces", () => {
    const unsplit = job({ bed: "333x418", splitPlate: false });
    expect(offersSplitZip(unsplit)).toBe(false);
    expect(splitBinaryStls(unsplit, "coin_Large_2up")).toHaveLength(0);
    expect(splitZipName("coin_Large_2up")).toBe("coin_Large_2up_split.zip");

    const split = job({ bed: "333x418", splitPlate: true, maxPrintBed: 250 });
    expect(split.splits.length).toBeGreaterThan(1);
    expect(offersSplitZip(split)).toBe(true);
  });

  it("names the archive from the existing stem (bed + up-count)", () => {
    expect(splitZipName("coin_Large_2up")).toBe("coin_Large_2up_split.zip");
    expect(splitZipName("coin_Mini_2up")).toBe("coin_Mini_2up_split.zip");
    expect(splitZipName("coin_MiniFrame_2up")).toBe("coin_MiniFrame_2up_split.zip");
    expect(splitZipName("token_Custom_1up")).toBe("token_Custom_1up_split.zip");
  });

  it("packs the same binary _splitKofN.stl files as individual downloads", async () => {
    const r = job({ bed: "333x418", splitPlate: true, maxPrintBed: 250 });
    const stem = "coin_Large_2up";
    const binaries = splitBinaryStls(r, stem);
    expect(binaries.length).toBe(r.splits.length);
    expect(binaries.length).toBeGreaterThan(1);
    expect(binaries.every((f) => /_split\d+of\d+\.stl$/.test(f.name))).toBe(true);
    expect(binaries.some((f) => f.name.includes("_ascii"))).toBe(false);

    const individuals = stlFiles(r, stem).filter((f) => f.name.endsWith(".stl") && !f.name.includes("_ascii"));
    expect(binaries.map((f) => f.name)).toEqual(individuals.map((f) => f.name));

    const zipBytes = await buildSplitZip(r, stem);
    const zip = await JSZip.loadAsync(zipBytes);
    const packed = Object.keys(zip.files).filter((n) => !zip.files[n].dir).sort();
    expect(packed).toEqual(binaries.map((f) => f.name).sort());
    expect(packed.some((n) => n.includes("_ascii"))).toBe(false);
    expect(packed.some((n) => n.endsWith(".dxf") || n.endsWith(".svg"))).toBe(false);

    for (const f of binaries) {
      const entry = await zip.file(f.name)!.async("uint8array");
      expect(entry).toEqual(new Uint8Array(f.data as ArrayBuffer));
    }
  });

  it("does not change laser exports when zipping split STLs", () => {
    const r = job({ bed: "333x418", splitPlate: true, maxPrintBed: 250 });
    const files = laserFiles(r, "coin_Large_2up");
    expect(files.every((f) => !f.name.includes("split") && !f.name.endsWith(".zip"))).toBe(true);
  });
});
