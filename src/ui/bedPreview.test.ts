import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DEFAULTS, FRAME_PLATE, LARGE_BED, MINI_BED } from "../constants";
import { generateJig } from "../cad/generate";
import { defaultSettings, newObject } from "../cad/history";
import { bboxOf } from "../cad/geom";
import { makeLStl, parseSTL } from "../cad/stl";
import type { JobSettings } from "../types";
import {
  BED_TEMPLATE,
  bedImageDest,
  bedTemplateUrl,
  bedToPlate,
  plateToBed,
  plateViewSize,
  previewPlateOffset,
  silhouetteLoopsOf,
} from "./bedPreview";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

describe("bed template asset", () => {
  it("ships public/bed-template.png with the calibrated inner rectangle", () => {
    const buf = readFileSync(resolve(root, "public", BED_TEMPLATE.file));
    expect(buf.subarray(0, 8).toString("binary")).toBe("\x89PNG\r\n\x1a\n");
    const w = buf.readUInt32BE(16);
    const h = buf.readUInt32BE(20);
    expect(w).toBe(BED_TEMPLATE.imageW);
    expect(h).toBe(BED_TEMPLATE.imageH);
    expect(BED_TEMPLATE.inner.w / BED_TEMPLATE.inner.h).toBeCloseTo(MINI_BED.w / MINI_BED.h, 8);
  });

  it("prefixes the image URL with the Vite/Pages base", () => {
    expect(bedTemplateUrl("/")).toBe("/bed-template.png");
    expect(bedTemplateUrl("/Jiggmaker/")).toBe("/Jiggmaker/bed-template.png");
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
