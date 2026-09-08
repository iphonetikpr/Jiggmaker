import { describe, expect, it } from "vitest";
import { bboxOf } from "../cad/geom";
import { generateJig } from "../cad/generate";
import { defaultSettings, newObject } from "../cad/history";
import { makeLStl } from "../cad/stl";
import { BED_MINI, bedToScreen, clientToBedMm, fitTemplateView, templateForResult } from "./bedPreview";
import { hitPieceLabel } from "./previewHit";

function rectJob(moves: Record<string, [number, number]> = {}, patch: Partial<Parameters<typeof generateJig>[2]> = {}) {
  const settings = { ...defaultSettings(), ...patch };
  const obj = newObject(0);
  obj.name = "coin";
  obj.mode = "rectangle";
  obj.rectW = 50;
  obj.rectH = 30;
  obj.count = 1;
  return generateJig([obj], {}, settings, moves);
}

describe("template hit-test (jiggenerator model)", () => {
  it("grabs a piece at its silhouette center and misses empty bed", () => {
    const r = rectJob();
    const p = r.placed[0];
    expect(hitPieceLabel(r.placed, p.cx, p.cy)).toBe(p.label);
    expect(hitPieceLabel(r.placed, 4, 4)).toBeNull();
    expect(hitPieceLabel(r.placed, r.bed.w - 4, r.bed.h - 4)).toBeNull();
  });

  it("round-trips screen → bed mm through the same view as drawing", () => {
    const r = rectJob();
    const p = r.placed[0];
    const tv = fitTemplateView(900, 420, r.template.bed.w, r.template.bed.h, 1, 0, 0, templateForResult(r));
    const [sx, sy] = bedToScreen(p.cx, p.cy, tv, r.template.bed.h);
    const [wx, wy] = clientToBedMm(sx, sy, 0, 0, tv, r.template.bed.h);
    expect(wx).toBeCloseTo(p.cx, 6);
    expect(wy).toBeCloseTo(p.cy, 6);
    expect(hitPieceLabel(r.placed, wx, wy)).toBe(p.label);

    const [emptyX, emptyY] = bedToScreen(8, 8, tv, r.template.bed.h);
    const miss = clientToBedMm(emptyX, emptyY, 0, 0, tv, r.template.bed.h);
    expect(hitPieceLabel(r.placed, miss[0], miss[1])).toBeNull();
  });

  it("still hits after pan/zoom and a persisted move", () => {
    const base = rectJob();
    const moved = rectJob({ [base.placed[0].label]: [18, -6] });
    const p = moved.placed[0];
    expect(p.cx).toBeCloseTo(base.placed[0].cx + 18, 5);
    expect(p.cy).toBeCloseTo(base.placed[0].cy - 6, 5);
    const tv = fitTemplateView(800, 400, moved.bed.w, moved.bed.h, 2.2, 40, -25, BED_MINI);
    const [sx, sy] = bedToScreen(p.cx, p.cy, tv, moved.bed.h);
    const [wx, wy] = clientToBedMm(sx, sy, 12, 8, tv, moved.bed.h);
    expect(hitPieceLabel(moved.placed, wx, wy)).toBe(p.label);
    const cut = moved.template.entities.find((e) => e.layer === "CUT" && e.points);
    expect(cut?.points?.some(([x]) => Math.abs(x - p.cx) < p.w)).toBe(true);
  });

  it("hits the L silhouette and pans the empty notch", () => {
    const buf = makeLStl(8);
    const obj = newObject(0);
    obj.mode = "silhouette";
    obj.stlName = "ell";
    obj.count = 1;
    const r = generateJig([obj], { [obj.id]: buf }, defaultSettings(), {});
    const p = r.placed[0];
    expect(hitPieceLabel(r.placed, p.cx, p.cy)).toBe(p.label);
    const art = bboxOf(p.art);
    // L is a 40×30 plate with a 20×20 bite from the top-right in part space;
    // after centering on the Mini bed the notch sits near (maxX - 8, maxY - 8).
    expect(hitPieceLabel(r.placed, art.maxX - 8, art.maxY - 8, 0.2)).toBeNull();
    expect(hitPieceLabel(r.placed, art.minX + 8, art.minY + 8)).toBe(p.label);
  });

  it("uses bed millimetres even when the alignment frame is on", () => {
    const r = rectJob({}, { useAdapter: true });
    expect(r.frameOn).toBe(true);
    expect(r.template.bed.w).toBe(333);
    expect(r.template.bed.h).toBe(88);
    const p = r.placed[0];
    const tv = fitTemplateView(900, 420, r.template.bed.w, r.template.bed.h, 1, 0, 0, BED_MINI);
    const [sx, sy] = bedToScreen(p.cx, p.cy, tv, r.template.bed.h);
    const [wx, wy] = clientToBedMm(sx, sy, 0, 0, tv, r.template.bed.h);
    expect(hitPieceLabel(r.placed, wx, wy)).toBe(p.label);
  });
});
