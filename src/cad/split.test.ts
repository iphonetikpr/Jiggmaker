import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { SPLIT_DOWEL_DIA, SPLIT_HOLE_DIA, SPLIT_OVERLAP } from "../constants";
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
import { buildSplitMeshes, dowelCenters, dowelSitesFor, placeSpansForJoint, splitSeamMarks } from "./split";
import type { JobSettings, PlateSplit, Tri } from "../types";

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

function filledLargeJob(count = 12) {
  const settings: JobSettings = {
    ...defaultSettings(),
    scaleComp: false,
    bed: "333x418",
    splitPlate: true,
    maxPrintBed: 250,
  };
  const obj = newObject(0);
  obj.name = "coin";
  obj.count = count;
  obj.rectW = 50;
  obj.rectH = 30;
  obj.mode = "rectangle";
  return generateJig([obj], {}, settings, {});
}

function adjacentPairs(splits: PlateSplit[], axis: "x" | "y"): Array<{ male: PlateSplit; female: PlateSplit }> {
  const out: Array<{ male: PlateSplit; female: PlateSplit }> = [];
  for (const male of splits) {
    const female =
      axis === "x"
        ? splits.find((s) => s.iy === male.iy && s.ix === male.ix + 1)
        : splits.find((s) => s.ix === male.ix && s.iy === male.iy + 1);
    if (female) out.push({ male, female });
  }
  return out;
}

/** Mean radius of circle verts on a cut-normal plane around (span, z). */
function meanRadius(mesh: Tri[], axis: "x" | "y", at: number, span: number, z: number): number {
  const ai = axis === "x" ? 0 : 1;
  const si = axis === "x" ? 1 : 0;
  const rs: number[] = [];
  for (const t of mesh) {
    for (let k = 0; k < 9; k += 3) {
      if (Math.abs(t[k + ai] - at) > 0.08) continue;
      const d = Math.hypot(t[k + si] - span, t[k + 2] - z);
      if (d > 0.8 && d < 2.1) rs.push(d);
    }
  }
  expect(rs.length).toBeGreaterThan(8);
  return rs.reduce((a, b) => a + b, 0) / rs.length;
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
    expect(splitSeamMarks(r.splits).every((m) => m.axis === "x")).toBe(true);
    expect(splitSeamMarks(r.splits).some((m) => m.axis === "y")).toBe(false);
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

  it("relocates blocked dowel centers along the cut instead of dropping the seam", () => {
    const preferred = dowelCenters(0, 166.5);
    expect(preferred.length).toBeGreaterThanOrEqual(2);
    const blocked = (u: number) => preferred.some((p) => Math.abs(u - p) < 6);
    const placed = placeSpansForJoint(0, 166.5, blocked);
    expect(placed.length).toBe(preferred.length);
    for (const u of placed) expect(blocked(u)).toBe(false);
  });

  it("puts matching pin/hole + overlap on every Y seam of a Large 2×2 grid", () => {
    const r = filledLargeJob(12);
    expect(r.splits).toHaveLength(4);
    expect(r.splits.every((s) => s.nx === 2 && s.ny === 2)).toBe(true);
    const marks = splitSeamMarks(r.splits);
    expect(marks.some((m) => m.axis === "x")).toBe(true);
    expect(marks.some((m) => m.axis === "y" && Math.abs(m.at - r.jig.h / 2) < 1)).toBe(true);

    const pieces = buildSplitMeshes(r);
    for (const pair of adjacentPairs(r.splits, "y")) {
      const male = dowelSitesFor(pair.male, r).filter((d) => d.axis === "y" && d.role === "male");
      const female = dowelSitesFor(pair.female, r).filter((d) => d.axis === "y" && d.role === "female");
      expect(male.length).toBeGreaterThanOrEqual(2);
      expect(female.map((d) => d.span.toFixed(3))).toEqual(male.map((d) => d.span.toFixed(3)));
      expect(male[0].at).toBeCloseTo(female[0].at, 6);
      expect(male[0].z).toBeCloseTo(r.solidH / 2, 6);

      const maleMesh = pieces.find((p) => p.split.label === pair.male.label)!.mesh;
      const femaleMesh = pieces.find((p) => p.split.label === pair.female.label)!.mesh;
      expect(meshBBox(maleMesh).maxY).toBeGreaterThan(pair.male.y1 + SPLIT_OVERLAP - 0.05);
      const pinR = meanRadius(maleMesh, "y", pair.male.y1 + SPLIT_OVERLAP, male[0].span, male[0].z);
      const holeR = meanRadius(femaleMesh, "y", pair.female.y0, female[0].span, female[0].z);
      expect(pinR).toBeCloseTo(SPLIT_DOWEL_DIA / 2, 2);
      expect(holeR).toBeGreaterThanOrEqual(3.2 / 2);
      expect(holeR).toBeLessThanOrEqual(3.3 / 2);
    }
    for (const pair of adjacentPairs(r.splits, "x")) {
      const male = dowelSitesFor(pair.male, r).filter((d) => d.axis === "x" && d.role === "male");
      const female = dowelSitesFor(pair.female, r).filter((d) => d.axis === "x" && d.role === "female");
      expect(male.length).toBeGreaterThanOrEqual(1);
      expect(female.map((d) => d.span.toFixed(3))).toEqual(male.map((d) => d.span.toFixed(3)));
      const maleMesh = pieces.find((p) => p.split.label === pair.male.label)!.mesh;
      expect(meshBBox(maleMesh).maxX).toBeGreaterThan(pair.male.x1 + SPLIT_OVERLAP - 0.05);
    }
  });

  it("does not place dowels through pockets", () => {
    for (const r of [job({ bed: "333x88", splitPlate: true }), filledLargeJob(12)]) {
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
