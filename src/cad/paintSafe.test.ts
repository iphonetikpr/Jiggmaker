import { describe, expect, it } from "vitest";
import { DEFAULTS, PAINT_SAFE_COLOR, PAINT_SAFE_DASH } from "../constants";
import { contoursSvg, laserFiles, templateSvg } from "./export";
import { bboxOf, rectLoop } from "./geom";
import { generateJig } from "./generate";
import { applyHistorySettings, defaultSettings, newObject, serializeJob } from "./history";
import { insetLoop, isPaintSafeGuide, paintSafeLoops } from "./paintSafe";
import { toSVG } from "./svg";
import type { JobSettings } from "../types";

function keycapJob(patch: Partial<JobSettings> = {}) {
  const settings: JobSettings = { ...defaultSettings(), ...patch };
  const obj = newObject(0);
  obj.name = "keycap";
  obj.count = 2;
  obj.rectW = 18;
  obj.rectH = 18;
  obj.mode = "rectangle";
  obj.clear = DEFAULTS.clearance;
  return generateJig([obj], {}, settings, {});
}

describe("paint-safe inset geometry", () => {
  it("insets an 18×18 square by 2.5 mm per side to 13×13", () => {
    const inner = insetLoop(rectLoop(18, 18), 2.5);
    expect(inner).toBeTruthy();
    const b = bboxOf([inner!]);
    expect(b.w).toBeCloseTo(13, 5);
    expect(b.h).toBeCloseTo(13, 5);
    expect(b.minX).toBeCloseTo(2.5, 5);
    expect(b.minY).toBeCloseTo(2.5, 5);
  });

  it("returns no loops when the toggle is off", () => {
    expect(paintSafeLoops([rectLoop(18, 18)], defaultSettings())).toEqual([]);
  });
});

describe("paint-safe template / contours", () => {
  it("is off by default and matches today's template (no inner GUIDE)", () => {
    const fresh = defaultSettings();
    expect(fresh.paintSafe).toBe(false);
    expect(fresh.paintSafeMode).toBe("inset");
    expect(fresh.paintSafeInset).toBe(2.5);
    expect(fresh.paintSafeW).toBe(13);
    expect(fresh.paintSafeH).toBe(13);

    const r = keycapJob();
    expect(r.placed.every((p) => p.paintSafe.length === 0)).toBe(true);
    expect(r.template.entities.filter(isPaintSafeGuide)).toHaveLength(0);
    const svg = String(templateSvg(r, "keycap_Mini_2up").data);
    expect(svg).not.toContain(PAINT_SAFE_COLOR);
    expect(svg).not.toContain("stroke-dasharray");
    expect(svg).not.toContain('id="GUIDE"');
  });

  it("adds a dashed green GUIDE inner for inset 2.5 on an 18×18 pocket", () => {
    const r = keycapJob({ paintSafe: true, paintSafeMode: "inset", paintSafeInset: 2.5 });
    expect(r.placed).toHaveLength(2);
    for (const p of r.placed) {
      expect(p.paintSafe.length).toBe(1);
      const outer = bboxOf(p.art.length ? p.art : p.loops);
      const inner = bboxOf(p.paintSafe);
      expect(outer.w).toBeCloseTo(18, 4);
      expect(outer.h).toBeCloseTo(18, 4);
      expect(inner.w).toBeCloseTo(13, 4);
      expect(inner.h).toBeCloseTo(13, 4);
      expect(inner.minX).toBeCloseTo(outer.minX + 2.5, 4);
      expect(inner.minY).toBeCloseTo(outer.minY + 2.5, 4);
    }

    const guides = r.template.entities.filter(isPaintSafeGuide);
    expect(guides).toHaveLength(2);
    expect(guides.every((e) => e.layer === "GUIDE")).toBe(true);
    expect(guides.every((e) => e.layer !== "CUT" && e.layer !== "POCKET")).toBe(true);
    expect(guides.every((e) => e.color === PAINT_SAFE_COLOR)).toBe(true);
    expect(guides.every((e) => e.dash?.[0] === PAINT_SAFE_DASH[0])).toBe(true);

    const cuts = r.template.entities.filter((e) => e.layer === "CUT" && e.closed && e.points);
    expect(cuts.length).toBeGreaterThanOrEqual(2);
    expect(cuts.every((e) => !e.dash?.length)).toBe(true);

    const svg = String(templateSvg(r, "keycap_Mini_2up").data);
    expect(svg).toContain('id="GUIDE"');
    expect(svg).toContain('data-layer="GUIDE"');
    expect(svg).toContain(PAINT_SAFE_COLOR);
    expect(svg).toContain("stroke-dasharray");
    expect(svg).not.toMatch(/data-layer="CUT"[^>]*stroke-dasharray/);
    expect(svg).not.toMatch(/stroke-dasharray[^>]*data-layer="CUT"/);
  });

  it("centers a fixed 13×13 GUIDE in the 18×18 silhouette", () => {
    const r = keycapJob({ paintSafe: true, paintSafeMode: "fixed", paintSafeW: 13, paintSafeH: 13 });
    const p = r.placed[0];
    const outer = bboxOf(p.art);
    const inner = bboxOf(p.paintSafe);
    expect(inner.w).toBeCloseTo(13, 5);
    expect(inner.h).toBeCloseTo(13, 5);
    expect((inner.minX + inner.maxX) / 2).toBeCloseTo((outer.minX + outer.maxX) / 2, 5);
    expect((inner.minY + inner.maxY) / 2).toBeCloseTo((outer.minY + outer.maxY) / 2, 5);
  });

  it("keeps laser CUT / nest / STL on the outer pocket when paint-safe is on", () => {
    const off = keycapJob({ paintSafe: false });
    const on = keycapJob({ paintSafe: true, paintSafeMode: "inset", paintSafeInset: 2.5 });

    expect(on.jig).toEqual(off.jig);
    expect(on.placed[0].w).toBeCloseTo(off.placed[0].w, 6);
    expect(on.placed[0].h).toBeCloseTo(off.placed[0].h, 6);
    expect(on.placed[0].cx).toBeCloseTo(off.placed[0].cx, 6);
    expect(on.placed[0].cy).toBeCloseTo(off.placed[0].cy, 6);
    expect(bboxOf(on.placed[0].loops)).toEqual(bboxOf(off.placed[0].loops));
    expect(on.mesh.length).toBe(off.mesh.length);
    expect(on.meshPockets[0].loops).toEqual(off.meshPockets[0].loops);

    const laserOn = on.laser.pocketEntities.filter((e) => e.layer === "CUT");
    const laserOff = off.laser.pocketEntities.filter((e) => e.layer === "CUT");
    expect(laserOn).toEqual(laserOff);
    expect(on.laser.pocketEntities.some(isPaintSafeGuide)).toBe(false);
    expect(on.laser.baseEntities.some(isPaintSafeGuide)).toBe(false);

    const pocketSvg = String(laserFiles(on, "keycap_Mini_2up").find((f) => f.name.endsWith("_POCKET.svg"))?.data);
    expect(pocketSvg).not.toContain(PAINT_SAFE_COLOR);
    expect(pocketSvg).not.toContain("stroke-dasharray");

    const contours = String(contoursSvg(on, "keycap_Mini_2up").data);
    expect(contours).toContain('data-layer="CUT"');
    expect(contours).toContain('data-layer="GUIDE"');
    expect(contours).toContain(PAINT_SAFE_COLOR);
    expect(contours).not.toMatch(/data-layer="CUT"[^>]*stroke-dasharray/);
    expect(contours).not.toMatch(/stroke-dasharray[^>]*data-layer="CUT"/);
  });

  it("does not put paint-safe loops on Contours CUT rings", () => {
    const r = keycapJob({ paintSafe: true, paintSafeMode: "fixed", paintSafeW: 13, paintSafeH: 13 });
    const svg = String(contoursSvg(r, "keycap_Mini_2up").data);
    const cutPaths = [...svg.matchAll(/<path[^>]*>/g)].filter((m) => m[0].includes('data-layer="CUT"'));
    expect(cutPaths.length).toBeGreaterThan(0);
    expect(cutPaths.every((m) => !m[0].includes("stroke-dasharray"))).toBe(true);
    expect(cutPaths.every((m) => !m[0].includes(PAINT_SAFE_COLOR))).toBe(true);
    const guidePaths = [...svg.matchAll(/<path[^>]*>/g)].filter((m) => m[0].includes('data-layer="GUIDE"'));
    expect(guidePaths.length).toBe(r.placed.length);
    expect(guidePaths.every((m) => m[0].includes("stroke-dasharray"))).toBe(true);
    expect(guidePaths.every((m) => m[0].includes(PAINT_SAFE_COLOR))).toBe(true);
  });

  it("moves the GUIDE with the piece", () => {
    const settings: JobSettings = {
      ...defaultSettings(),
      paintSafe: true,
      paintSafeMode: "fixed",
      paintSafeW: 13,
      paintSafeH: 13,
    };
    const obj = newObject(0);
    obj.name = "keycap";
    obj.rectW = 18;
    obj.rectH = 18;
    obj.mode = "rectangle";
    const base = generateJig([obj], {}, settings, {});
    const label = base.placed[0].label;
    const moved = generateJig([obj], {}, settings, { [label]: [10, -3] });
    expect(moved.placed[0].cx).toBeCloseTo(base.placed[0].cx + 10, 5);
    expect(bboxOf(moved.placed[0].paintSafe).minX).toBeCloseTo(bboxOf(base.placed[0].paintSafe).minX + 10, 5);
    expect(bboxOf(moved.placed[0].paintSafe).minY).toBeCloseTo(bboxOf(base.placed[0].paintSafe).minY - 3, 5);
  });
});

describe("paint-safe history", () => {
  it("round-trips paintSafe fields and defaults missing keys to off", () => {
    const settings = defaultSettings();
    settings.paintSafe = true;
    settings.paintSafeMode = "fixed";
    settings.paintSafeW = 13;
    settings.paintSafeH = 13;
    const job = serializeJob("caps", settings, [newObject(0)], {}, {});
    expect(job.settings.paintSafe).toBe(true);
    expect(job.settings.paintSafeMode).toBe("fixed");
    const restored = applyHistorySettings(job.settings);
    expect(restored.paintSafe).toBe(true);
    expect(restored.paintSafeMode).toBe("fixed");
    expect(restored.paintSafeW).toBe(13);
    expect(restored.paintSafeH).toBe(13);

    const legacy = applyHistorySettings({ bed: "333x88", nest: true });
    expect(legacy.paintSafe).toBe(false);
    expect(legacy.paintSafeMode).toBe("inset");
    expect(legacy.paintSafeInset).toBe(2.5);
  });
});

describe("toSVG layer attrs", () => {
  it("labels GUIDE paint-safe paths without promoting them to CUT", () => {
    const svg = toSVG(20, 20, [
      { layer: "CUT", points: rectLoop(18, 18), closed: true, strokeWidth: 0.2 },
      {
        layer: "GUIDE",
        points: rectLoop(13, 13, 2.5, 2.5),
        closed: true,
        color: PAINT_SAFE_COLOR,
        dash: [...PAINT_SAFE_DASH],
        strokeWidth: 0.25,
      },
    ]);
    expect(svg).toContain('data-layer="CUT"');
    expect(svg).toContain('data-layer="GUIDE"');
    expect(svg).toContain('id="GUIDE"');
    expect(svg).toContain(PAINT_SAFE_COLOR);
    expect(svg).not.toMatch(/data-layer="CUT"[^>]*stroke-dasharray/);
  });
});
