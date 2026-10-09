import { describe, expect, it } from "vitest";
import { DEFAULTS, LARGE_BED } from "../constants";
import { summaryJigSize, summaryStlSize, THIN_BASE_WARNING, thinBaseWarning } from "../ui/summary";
import { generateJig } from "./generate";
import { bboxOf } from "./geom";
import { applyHistorySettings, defaultSettings, newObject } from "./history";
import { solidHeight } from "./mesh";
import { makeSeatingPlateStl } from "./stl";
import type { Entity, JigResult, JobSettings } from "../types";

function plateSettings(patch: Partial<JobSettings> = {}): JobSettings {
  return {
    ...defaultSettings(),
    bed: "333x418",
    scaleComp: false,
    center: true,
    nest: false,
    pocketDepth: DEFAULTS.pocketDepth,
    baseThk: DEFAULTS.baseThk,
    ...patch,
  };
}

function seatingJob(patch: Partial<JobSettings> = {}): JigResult {
  const settings = plateSettings(patch);
  const obj = newObject(0);
  obj.name = "placa";
  obj.stlName = "placa";
  obj.mode = "silhouette";
  obj.up = "z-";
  obj.clear = 0.15;
  obj.count = 1;
  return generateJig([obj], { [obj.id]: makeSeatingPlateStl() }, settings, {});
}

function cuts(entities: Entity[]) {
  return entities.filter((e) => e.layer === "CUT" && e.closed && (e.points?.length || 0) >= 3);
}

describe("tight jig footprint", () => {
  it("trims the STL to the parts plus the existing margin, not the bed", () => {
    const tight = seatingJob({ footprint: "tight" });
    const full = seatingJob({ footprint: "bed" });
    expect(summaryJigSize(tight)).toBe("144 × 182 mm");
    expect(tight.jig.w).toBeLessThan(160);
    expect(tight.jig.h).toBeLessThan(200);
    expect(tight.jig.w).toBeCloseTo(139.7 + 2 * DEFAULTS.marginX, 0);
    expect(tight.jig.h).toBeCloseTo(177.8 + 2 * DEFAULTS.marginY, 0);
    expect(full.jig.w).toBe(LARGE_BED.w);
    expect(full.jig.h).toBe(LARGE_BED.h);
    expect(summaryStlSize(tight)).toBe("144 × 182 × 5.0 mm");
    expect(tight.solidH).toBeCloseTo(DEFAULTS.baseThk + DEFAULTS.pocketDepth, 5);
    expect(thinBaseWarning(tight.jig.w, tight.jig.h, tight.baseThk)).toBeNull();
    expect(thinBaseWarning(full.jig.w, full.jig.h, full.baseThk)).toBe(THIN_BASE_WARNING);
  });

  it("keeps the Studio template identical to Full bed, pockets at the same bed positions", () => {
    const tight = seatingJob({ footprint: "tight", showNum: true });
    const full = seatingJob({ footprint: "bed", showNum: true });
    expect(JSON.stringify(tight.template)).toBe(JSON.stringify(full.template));
    expect(tight.template.bed.w).toBe(LARGE_BED.w);
    expect(tight.template.bed.h).toBe(LARGE_BED.h);
    expect(cuts(tight.template.entities)).toHaveLength(6);
    expect(cuts(full.template.entities)).toHaveLength(6);

    const bedCuts = cuts(tight.template.entities);
    const pockets = tight.meshPockets[0].loops;
    for (const cut of bedCuts) {
      const c = bboxOf([cut.points!]);
      const cx = (c.minX + c.maxX) / 2;
      const cy = (c.minY + c.maxY) / 2;
      const hit = pockets.some((loop) => {
        const p = bboxOf([loop]);
        const px = (p.minX + p.maxX) / 2 + tight.jigBedOrigin.x;
        const py = (p.minY + p.maxY) / 2 + tight.jigBedOrigin.y;
        return Math.hypot(px - cx, py - cy) < 0.6;
      });
      expect(hit).toBe(true);
    }
  });

  it("places a centered tight plate's corner inset from the bed origin", () => {
    const tight = seatingJob({ footprint: "tight", center: true });
    expect(tight.jigBedOrigin.x).toBeCloseTo((LARGE_BED.w - tight.jig.w) / 2, 3);
    expect(tight.jigBedOrigin.y).toBeCloseTo((LARGE_BED.h - tight.jig.h) / 2, 3);
    expect(tight.jigBedOrigin.x).toBeCloseTo(-tight.plateOffset.x, 5);
    expect(tight.jigBedOrigin.y).toBeCloseTo(-tight.plateOffset.y, 5);
    expect(tight.jigBedOrigin.x).toBeGreaterThan(10);

    const packed = seatingJob({ footprint: "tight", center: false });
    expect(packed.jigBedOrigin.x).toBeCloseTo(0, 5);
    expect(packed.jigBedOrigin.y).toBeCloseTo(0, 5);
    expect(summaryJigSize(packed)).toBe(summaryJigSize(tight));
  });

  it("does not split a 144×182 tight jig", () => {
    const tight = seatingJob({ footprint: "tight", splitPlate: true, maxPrintBed: 250 });
    expect(tight.jig.w).toBeLessThan(250);
    expect(tight.jig.h).toBeLessThan(250);
    expect(tight.oversized).toBe(false);
    expect(tight.splits).toHaveLength(0);

    const full = seatingJob({ footprint: "bed", splitPlate: true, maxPrintBed: 250 });
    expect(full.oversized).toBe(true);
    expect(full.splits.length).toBeGreaterThanOrEqual(2);
  });

  it("sets height to base thickness plus pocket depth", () => {
    expect(solidHeight(DEFAULTS.baseThk, DEFAULTS.pocketDepth)).toBe(5);
    const deep = seatingJob({ footprint: "tight", baseThk: 3, pocketDepth: 21 });
    expect(deep.solidH).toBeCloseTo(24, 5);
    expect(deep.pocketDepth).toBe(21);
    expect(summaryStlSize(deep)).toBe("144 × 182 × 24.0 mm");
    expect(deep.meshPockets[0].loops.length).toBe(6);

    const through = seatingJob({ footprint: "tight", baseThk: 0, pocketDepth: 4 });
    expect(through.solidH).toBeCloseTo(4, 5);
  });

  it("leaves a saved full-bed job on Full bed and defaults a missing footprint to Tight", () => {
    expect(defaultSettings().footprint).toBe("tight");
    expect(applyHistorySettings({ bed: "333x418", nest: true }).footprint).toBe("tight");
    expect(applyHistorySettings({ footprint: "bed", pocketDepth: "4" }).footprint).toBe("bed");
    expect(applyHistorySettings({ footprint: "nope" }).footprint).toBe("tight");
  });

  it("does not move template pockets when the Mini frame is on", () => {
    const obj = newObject(0);
    obj.mode = "rectangle";
    obj.rectW = 40;
    obj.rectH = 20;
    obj.count = 1;
    const tight = generateJig([obj], {}, { ...defaultSettings(), useAdapter: true, footprint: "tight" }, {});
    const full = generateJig([obj], {}, { ...defaultSettings(), useAdapter: true, footprint: "bed" }, {});
    expect(JSON.stringify(tight.template)).toBe(JSON.stringify(full.template));
    expect(full.jig.w).toBe(334);
    expect(full.jig.h).toBe(90);
    expect(tight.jig.w).toBeLessThan(80);
    expect(tight.jig.h).toBeLessThan(40);
    expect(tight.splits).toHaveLength(0);
    const outline = tight.laser.pocketEntities.find((e) => e.layer === "OUTLINE" && e.points);
    const box = bboxOf([outline!.points!]);
    expect(box.w).toBeCloseTo(tight.jig.w, 3);
    expect(box.h).toBeCloseTo(tight.jig.h, 3);
  });
});
