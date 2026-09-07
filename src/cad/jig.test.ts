import { describe, expect, it } from "vitest";
import { DEFAULTS, FRAME_PLATE, HISTORY_KEY, MINI_BED, POCKET_DEPTH_EXTRA, SCALE_COMP } from "../constants";
import { toDXF } from "./dxf";
import { exportBasename } from "./filename";
import { generateJig } from "./generate";
import { applyHistorySettings, defaultSettings, loadHistory, mergeImported, newObject, saveHistory, serializeJob } from "./history";
import { toAsciiSTL, toBinarySTL } from "./mesh";
import { toSVG } from "./svg";
import { makeBoxStl, makeLStl, parseSTL } from "./stl";
import type { JobSettings } from "../types";

function rectJob(patch: Partial<JobSettings> = {}) {
  const settings: JobSettings = { ...defaultSettings(), ...patch };
  const obj = newObject(0);
  obj.name = "coin";
  obj.count = 2;
  obj.rectW = 40;
  obj.rectH = 20;
  obj.mode = "rectangle";
  obj.clear = DEFAULTS.clearance;
  return generateJig([obj], {}, settings, {});
}

describe("locked constants", () => {
  it("keeps CAD locks", () => {
    expect(SCALE_COMP).toBe(1.003);
    expect(POCKET_DEPTH_EXTRA).toBe(0.2);
    expect(MINI_BED).toEqual({ w: 333, h: 88, id: "333x88", name: "Mini" });
    expect(FRAME_PLATE.w).toBe(334);
    expect(FRAME_PLATE.h).toBe(90);
    expect(DEFAULTS.pocketDepth).toBe(4);
    expect(DEFAULTS.baseThk).toBe(3);
    expect(DEFAULTS.matThk).toBe(3);
    expect(DEFAULTS.dpi).toBe(300);
    expect(DEFAULTS.clearance).toBe(0.15);
    expect(DEFAULTS.maxPrintBed).toBe(250);
    expect(DEFAULTS.qty).toBe(1);
    expect(HISTORY_KEY).toBe("eufyJig.history.v1");
  });

  it("starts a single object at quantity 1", () => {
    expect(newObject(0).count).toBe(1);
    expect(newObject(1).count).toBe(1);
    const fresh = generateJig([newObject(0)], {}, defaultSettings(), {});
    expect(fresh.totalUnits).toBe(1);
  });
});

describe("rectangular jig", () => {
  it("exports Mini plate 333×88 and matching filenames", () => {
    const r = rectJob();
    expect(r.jig.w).toBe(333);
    expect(r.jig.h).toBe(88);
    expect(r.totalUnits).toBe(2);
    expect(r.template.bed.w).toBe(333);
    const stem = exportBasename("coin", r.plateName, r.totalUnits);
    expect(stem).toBe("coin_Mini_2up");
    const dxf = toDXF(r.laser.pocketEntities);
    expect(dxf).toContain("$INSUNITS");
    expect(dxf).toMatch(/70\n4\n/);
    expect(dxf).toContain("CUT");
    const svg = toSVG(r.jig.w, r.jig.h, r.laser.pocketEntities);
    expect(svg).toContain('viewBox="0 0 333 88"');
    expect(svg).toContain("#E74C3C");
    expect(r.mesh.length).toBeGreaterThan(8);
    const bin = toBinarySTL(r.mesh);
    const view = new DataView(bin);
    expect(view.getUint32(80, true)).toBe(r.mesh.length);
    const ascii = toAsciiSTL(r.mesh, stem);
    expect(ascii.startsWith("solid ")).toBe(true);
  });

  it("frame checkbox yields 334×90 plate, template stays Mini", () => {
    const r = rectJob({ useAdapter: true });
    expect(r.frameOn).toBe(true);
    expect(r.jig.w).toBe(334);
    expect(r.jig.h).toBe(90);
    expect(r.jig.cornerR).toBe(8);
    expect(r.template.bed.w).toBe(333);
    expect(r.template.bed.h).toBe(88);
    expect(r.plateName).toBe("MiniFrame");
    const svg = toSVG(r.jig.w, r.jig.h, r.laser.pocketEntities);
    expect(svg).toContain('viewBox="0 0 334 90"');
  });

  it("warns when plate > maxPrintBed and can split", () => {
    const r = rectJob({ maxPrintBed: 250, splitPlate: false });
    expect(r.oversized).toBe(true);
    expect(r.warn).toMatch(/H2/);
    const s = rectJob({ maxPrintBed: 250, splitPlate: true });
    expect(s.splits.length).toBeGreaterThanOrEqual(2);
    expect(s.warn).toMatch(/split/i);
  });

  it("through-hole (baseThk=0) still meshes", () => {
    const r = rectJob({ baseThk: 0 });
    expect(r.mesh.length).toBeGreaterThan(8);
  });

  it("does not apply scaleComp to SVG/DXF size", () => {
    const a = rectJob({ scaleComp: true });
    const b = rectJob({ scaleComp: false });
    expect(a.jig.w).toBe(b.jig.w);
    const sa = toSVG(a.jig.w, a.jig.h, a.laser.pocketEntities);
    const sb = toSVG(b.jig.w, b.jig.h, b.laser.pocketEntities);
    expect(sa).toBe(sb);
    expect(a.mesh.length).toBeGreaterThan(0);
    expect(b.mesh.length).toBeGreaterThan(0);
  });
});

describe("STL silhouette", () => {
  it("parses a box and builds a pocket", () => {
    const buf = makeBoxStl(30, 15, 8);
    const mesh = parseSTL(buf);
    expect(mesh.count).toBe(12);
    const settings = defaultSettings();
    const obj = newObject(0);
    obj.name = "box";
    obj.mode = "silhouette";
    obj.stlName = "box";
    obj.count = 1;
    const r = generateJig([obj], { [obj.id]: buf }, settings, {});
    expect(r.objects[0].w).toBeGreaterThan(29);
    expect(r.totalUnits).toBe(1);
  });

  it("L-shaped STL keeps a non-rectangular art outline", () => {
    const buf = makeLStl(8);
    const settings = defaultSettings();
    const obj = newObject(0);
    obj.name = "ell";
    obj.mode = "silhouette";
    obj.stlName = "ell";
    obj.count = 1;
    const r = generateJig([obj], { [obj.id]: buf }, settings, {});
    const art = r.placed[0].art;
    expect(art[0].length).toBeGreaterThan(4);
    expect(r.template.entities.some((e) => e.layer === "CUT" && (e.points?.length || 0) > 4)).toBe(true);
  });
});

describe("history", () => {
  it("round-trips source-compatible keys", () => {
    const settings = defaultSettings();
    settings.useAdapter = true;
    settings.scaleComp = false;
    const obj = newObject(0);
    obj.name = "coin";
    const job = serializeJob("demo", settings, [obj], {}, {});
    expect(job.settings.bed).toBe("333x88");
    expect(job.settings.useAdapter).toBe(true);
    expect(job.settings.baseThk).toBe(3);
    expect(job.settings.pocketDepth).toBe(4);
    const restored = applyHistorySettings(job.settings);
    expect(restored.useAdapter).toBe(true);
    expect(restored.scaleComp).toBe(false);
    const { added, jobs } = mergeImported([], [job]);
    expect(added).toBe(1);
    expect(jobs[0].name).toBe("demo");
  });

  it("imports jiggenerator-style jobs without extra keys", () => {
    const incoming = {
      id: "hlegacy",
      name: "old",
      date: "2026-01-01T00:00:00.000Z",
      settings: {
        bed: "333x88",
        spacingX: "5",
        spacingY: "5",
        marginX: "2",
        marginY: "2",
        objGap: "10",
        footprint: "tight",
        offsetPct: "50",
        matThk: "3",
        pickDia: "8",
        baseThk: "3",
        pocketDepth: "4",
        dpi: "300",
        center: true,
        nest: true,
        pickOut: false,
        showNum: true,
        useAdapter: true,
      },
      objects: [{ name: "a", count: 3, up: "z+", rot: 0, mirror: false, auto: false, mode: "rectangle", clear: 0.15, holes: "none", stlName: "a" }],
    };
    const restored = applyHistorySettings(incoming.settings);
    expect(restored.bed).toBe("333x88");
    expect(restored.footprint).toBe("tight");
    expect(restored.useAdapter).toBe(true);
    expect(restored.scaleComp).toBe(true);
    expect(restored.maxPrintBed).toBe(250);
    const { added } = mergeImported([], incoming);
    expect(added).toBe(1);
  });

  it("uses a path-independent localStorage key (NAS and Pages share the same API)", () => {
    expect(HISTORY_KEY).toBe("eufyJig.history.v1");
    const src = loadHistory.toString() + saveHistory.toString();
    expect(src).toContain("HISTORY_KEY");
    expect(src).not.toMatch(/location\.pathname|window\.location/);
  });
});
