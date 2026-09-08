import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DEFAULTS, FRAME_PLATE, LARGE_BED } from "../constants";
import { generateJig } from "../cad/generate";
import { defaultSettings, newObject } from "../cad/history";
import { bboxOf } from "../cad/geom";
import { makeLStl, parseSTL } from "../cad/stl";
import type { JobSettings } from "../types";
import {
  BED_MINI,
  BED_STD,
  BED_TEMPLATE,
  bedImageDest,
  bedSvgWorld,
  bedTemplateUrl,
  bedToPlate,
  bedToScreen,
  clientToBedMm,
  fitBedView,
  fitTemplateView,
  plantillaHasBranding,
  plantillaMarkup,
  plateToBed,
  plateViewSize,
  previewPlateOffset,
  silhouetteLoopsOf,
  templateForResult,
} from "./bedPreview";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

describe("bed template asset", () => {
  it("ships jiggenerator Mini/Standard plantilla SVGs with official inner rects", () => {
    const mini = readFileSync(resolve(root, "public", BED_MINI.file), "utf8");
    const std = readFileSync(resolve(root, "public", BED_STD.file), "utf8");
    const miniAsset = readFileSync(resolve(root, "src/assets", BED_MINI.file), "utf8");
    const stdAsset = readFileSync(resolve(root, "src/assets", BED_STD.file), "utf8");
    expect(mini).toContain('viewBox="0 0 1089.552 323.158"');
    expect(std).toContain('viewBox="0 0 1085.983 1284.553"');
    expect(mini.startsWith("<?xml")).toBe(true);
    expect(std.startsWith("<?xml")).toBe(true);
    expect(mini.length).toBe(38571);
    expect(std.length).toBe(55337);
    expect(mini).toBe(miniAsset);
    expect(std).toBe(stdAsset);
    expect(plantillaHasBranding(mini)).toBe(true);
    expect(plantillaHasBranding(std)).toBe(true);
    expect(plantillaHasBranding('<svg viewBox="0 0 10 10"><rect/></svg>')).toBe(false);
    expect(plantillaMarkup(mini)).toContain('id="plantilla-bg"');
    expect(BED_MINI.id).toBe("bedSvgMini");
    expect(BED_STD.id).toBe("bedSvgStd");
    expect(BED_MINI.inner).toEqual({ x: 37.889, y: 32.312, w: 935.447, h: 255.118 });
    expect(BED_STD.inner).toEqual({ x: 34.195, y: 33.485, w: 935.698, h: 1218.787 });
  });

  it("prefixes the image URL with the Vite/Pages base", () => {
    expect(bedTemplateUrl("bed-mini.svg", "/")).toBe("/bed-mini.svg");
    expect(bedTemplateUrl("bed-mini.svg", "/Jiggmaker/")).toBe("/Jiggmaker/bed-mini.svg");
  });

  it("picks Mini vs Standard SVG from the bed", () => {
    const mini = generateJig([newObject(0)], {}, defaultSettings(), {});
    const large = generateJig([newObject(0)], {}, { ...defaultSettings(), bed: "333x418" }, {});
    expect(templateForResult(mini)).toBe(BED_MINI);
    expect(templateForResult(large)).toBe(BED_STD);
  });
});

describe("plate mapping", () => {
  function job(patch: Partial<JobSettings>) {
    const settings = { ...defaultSettings(), ...patch };
    const obj = newObject(0);
    obj.mode = "rectangle";
    obj.rectW = 40;
    obj.rectH = 20;
    return generateJig([obj], {}, settings, {});
  }

  it("maps Mini / Frame / Large plates", () => {
    const mini = job({ bed: "333x88", useAdapter: false });
    expect(plateViewSize(mini)).toEqual({ w: 333, h: 88 });
    expect(previewPlateOffset(mini)).toEqual({ x: 0, y: 0 });

    const frame = job({ bed: "333x88", useAdapter: true });
    expect(frame.frameOn).toBe(true);
    expect(frame.jig.w).toBe(FRAME_PLATE.w);
    expect(frame.jig.h).toBe(FRAME_PLATE.h);
    expect(plateViewSize(frame)).toEqual({ w: 334, h: 90 });
    expect(previewPlateOffset(frame)).toEqual({ x: 0.5, y: 1 });
    expect(bedToPlate(frame, 0, 0)).toEqual([0.5, 1]);
    expect(plateToBed(frame, 0.5, 1)).toEqual([0, 0]);

    const large = job({ bed: "333x418", useAdapter: false });
    expect(plateViewSize(large)).toEqual({ w: LARGE_BED.w, h: LARGE_BED.h });
  });

  it("maps the inner blue rectangle onto the plate quad", () => {
    const ox = 10,
      oy = 20,
      sc = 2,
      plateW = 334,
      plateH = 90;
    const d = bedImageDest(BED_TEMPLATE, ox, oy, plateW, plateH, sc);
    const sx = d.w / BED_TEMPLATE.imageW;
    const sy = d.h / BED_TEMPLATE.imageH;
    const innerLeft = d.x + BED_TEMPLATE.inner.x * sx;
    const innerTop = d.y + BED_TEMPLATE.inner.y * sy;
    const innerRight = d.x + (BED_TEMPLATE.inner.x + BED_TEMPLATE.inner.w) * sx;
    const innerBottom = d.y + (BED_TEMPLATE.inner.y + BED_TEMPLATE.inner.h) * sy;
    expect(innerLeft).toBeCloseTo(ox, 8);
    expect(innerTop).toBeCloseTo(oy, 8);
    expect(innerRight).toBeCloseTo(ox + plateW * sc, 8);
    expect(innerBottom).toBeCloseTo(oy + plateH * sc, 8);
  });

  it("fits the plantilla with one CAD millimetre scale (jiggenerator O)", () => {
    const v = fitTemplateView(1000, 400, 333, 88, 1, 0, 0, BED_MINI);
    const ext = bedSvgWorld(BED_MINI, 333, 88);
    expect(v.imgX).toBeCloseTo(v.ox + ext.x0 * v.sc, 6);
    expect(v.imgY).toBeCloseTo(v.oy + (88 - ext.y1) * v.sc, 6);
    expect(v.imgW).toBeCloseTo((ext.x1 - ext.x0) * v.sc, 6);
    const [sx, sy] = bedToScreen(0, 0, v, 88);
    const back = clientToBedMm(sx, sy, 0, 0, v, 88);
    expect(back[0]).toBeCloseTo(0, 8);
    expect(back[1]).toBeCloseTo(0, 8);
    const innerRight = bedToScreen(333, 88, v, 88);
    expect(innerRight[0]).toBeCloseTo(v.ox + 333 * v.sc, 6);
    expect(innerRight[1]).toBeCloseTo(v.oy, 6);
  });

  it("fits the full plantilla (QR / eufyMake rail included) then maps the inner rect", () => {
    const viewW = 1000,
      viewH = 400,
      plateW = 333,
      plateH = 88;
    const v = fitBedView(viewW, viewH, plateW, plateH, 1, 0, 0);
    expect(v.imgX).toBeGreaterThanOrEqual(-0.5);
    expect(v.imgY).toBeGreaterThanOrEqual(-0.5);
    expect(v.imgX + v.imgW).toBeLessThanOrEqual(viewW + 0.5);
    expect(v.imgY + v.imgH).toBeLessThanOrEqual(viewH + 0.5);
    expect(v.ox).toBeCloseTo(v.imgX + (BED_TEMPLATE.inner.x / BED_TEMPLATE.imageW) * v.imgW, 6);
    expect(v.oy + plateH * v.scY).toBeCloseTo(v.imgY + ((BED_TEMPLATE.inner.y + BED_TEMPLATE.inner.h) / BED_TEMPLATE.imageH) * v.imgH, 6);
    expect(plateW * v.scX).toBeCloseTo((BED_TEMPLATE.inner.w / BED_TEMPLATE.imageW) * v.imgW, 6);
  });
});

describe("STL silhouette on the bed", () => {
  it("builds a real L outline (not a 4-point rectangle) and updates with rotation", () => {
    const buf = makeLStl(8);
    expect(parseSTL(buf).count).toBeGreaterThan(12);
    const settings = defaultSettings();
    const obj = newObject(0);
    obj.name = "bracket";
    obj.mode = "silhouette";
    obj.stlName = "bracket";
    obj.count = 1;
    obj.up = "z+";
    obj.rot = 0;
    obj.clear = DEFAULTS.clearance;
    const r = generateJig([obj], { [obj.id]: buf }, settings, {});
    expect(r.totalUnits).toBe(1);
    const loops = silhouetteLoopsOf(r.placed[0]);
    expect(loops.length).toBeGreaterThanOrEqual(1);
    expect(loops[0].length).toBeGreaterThan(4);
    const bb = bboxOf(loops);
    expect(bb.w).toBeGreaterThan(38);
    expect(bb.h).toBeGreaterThan(28);
    expect(Math.abs(bb.w - 40)).toBeLessThan(3);
    expect(Math.abs(bb.h - 30)).toBeLessThan(3);

    obj.rot = 90;
    const rotated = generateJig([obj], { [obj.id]: buf }, settings, {});
    const rb = bboxOf(silhouetteLoopsOf(rotated.placed[0]));
    expect(rb.w).toBeGreaterThan(28);
    expect(rb.h).toBeGreaterThan(38);
  });
});
