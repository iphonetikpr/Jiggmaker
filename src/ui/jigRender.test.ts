import { describe, expect, it } from "vitest";
import { DEFAULTS } from "../constants";
import { generateJig } from "../cad/generate";
import { defaultSettings, newObject } from "../cad/history";
import { jigOrbitCamera, jigViewScale } from "./partView";
import {
  JIG_SAMPLE_IDLE,
  VIEWCUBE,
  hitViewCubeFace,
  jigFaceShade,
  jigHudCaption,
  jigPreviewSample,
  renderJigMesh,
  viewCubeLayout,
} from "./jigRender";
import { previewHint } from "./previewHint";

function rectJob() {
  const settings = { ...defaultSettings(), scaleComp: false };
  const obj = newObject(0);
  obj.name = "coin";
  obj.mode = "rectangle";
  obj.rectW = 40;
  obj.rectH = 20;
  obj.clear = DEFAULTS.clearance;
  obj.count = 4;
  return generateJig([obj], {}, settings, {});
}

describe("3D jig lighting", () => {
  it("darkens pocket floors vs the plate top (cheap AO)", () => {
    const up: [number, number, number] = [0, 0, 1];
    const top = jigFaceShade(up, 7, 0, 7);
    const floor = jigFaceShade(up, 3, 0, 7);
    expect(floor).toBeLessThan(top * 0.85);
    expect(top).toBeGreaterThan(0.45);
  });

  it("keeps side walls lit by the fill so they are not black", () => {
    const wall = jigFaceShade([1, 0, 0], 5, 0, 7);
    expect(wall).toBeGreaterThan(0.12);
    expect(wall).toBeLessThan(jigFaceShade([0, 0, 1], 7, 0, 7));
  });

  it("rasterizes a Mini plate with a brightness range so pockets are not flat", () => {
    const r = rectJob();
    expect(r.jig.w).toBe(333);
    expect(r.jig.h).toBe(88);
    expect(r.solidH).toBeCloseTo(7, 5);
    const W = 420,
      H = 240;
    const cam = jigOrbitCamera(r.jig.w, r.jig.h, r.solidH, r.mesh, W, H, 1);
    const frame = renderJigMesh(r.mesh, cam, 0.62, -0.65, W, H, [200, 200, 200]);
    expect(frame.w).toBe(W);
    expect(frame.h).toBe(H);
    let minL = 255,
      maxL = 0,
      filled = 0;
    for (let i = 0; i < frame.data.length; i += 4) {
      if (frame.data[i] === 32 && frame.data[i + 1] === 32 && frame.data[i + 2] === 36) continue;
      const L = (frame.data[i] + frame.data[i + 1] + frame.data[i + 2]) / 3;
      if (L < minL) minL = L;
      if (L > maxL) maxL = L;
      filled++;
    }
    expect(filled).toBeGreaterThan(2000);
    expect(maxL - minL).toBeGreaterThan(28);
  });
});

describe("3D jig supersample", () => {
  it("renders above CSS×DPR at rest and keeps the canvas aspect", () => {
    const s = jigPreviewSample(800, 400, 1, false);
    expect(s.scale).toBe(JIG_SAMPLE_IDLE);
    expect(s.w / 800).toBeCloseTo(JIG_SAMPLE_IDLE, 6);
    expect(s.w / s.h).toBeCloseTo(800 / 400, 6);
  });

  it("does not use the Mini 333×88 bed aspect for the sample buffer", () => {
    const s = jigPreviewSample(900, 400, 1, false);
    expect(s.w / s.h).toBeCloseTo(900 / 400, 6);
    expect(s.w / s.h).not.toBeCloseTo(333 / 88, 1);
  });

  it("drops to 1× while dragging", () => {
    const s = jigPreviewSample(640, 400, 1, true);
    expect(s.w).toBe(640);
    expect(s.h).toBe(400);
  });
});

describe("viewcube is cubic", () => {
  it("uses the same pixel scale on X and Y on a wide Mini canvas", () => {
    const wide = viewCubeLayout(900, 400, 0.62, -0.65);
    const tall = viewCubeLayout(400, 900, 0.62, -0.65);
    expect(wide.scX).toBe(wide.scY);
    expect(wide.scX).toBe(VIEWCUBE.sc);
    expect(wide.viewportW).toBe(wide.viewportH);
    expect(wide.viewportW).toBe(VIEWCUBE.size);
    expect(tall.sc).toBe(wide.sc);
    expect(wide.cx).toBeGreaterThan(800);
    expect(wide.cy).toBeLessThan(80);
  });

  it("draws TOP as a square from a top-down view", () => {
    const layout = viewCubeLayout(900, 400, 0, 0);
    const top = layout.faces.find((f) => f.lbl === "TOP");
    expect(top).toBeTruthy();
    const xs = top!.poly.map((p) => p[0]);
    const ys = top!.poly.map((p) => p[1]);
    const w = Math.max(...xs) - Math.min(...xs);
    const h = Math.max(...ys) - Math.min(...ys);
    expect(w).toBeCloseTo(h, 6);
    expect(w).toBeCloseTo(2 * VIEWCUBE.sc, 6);
    expect(w / h).toBeCloseTo(1, 6);
    expect(w / h).not.toBeCloseTo(333 / 88, 1);
  });

  it("keeps relative cube geometry identical on 900×400 vs 400×400", () => {
    const a = viewCubeLayout(900, 400, 0.62, -0.65);
    const b = viewCubeLayout(400, 400, 0.62, -0.65);
    const topA = a.faces.find((f) => f.lbl === "TOP")!;
    const topB = b.faces.find((f) => f.lbl === "TOP")!;
    for (let i = 0; i < 4; i++) {
      expect(topA.poly[i][0] - a.cx).toBeCloseTo(topB.poly[i][0] - b.cx, 6);
      expect(topA.poly[i][1] - a.cy).toBeCloseTo(topB.poly[i][1] - b.cy, 6);
    }
  });

  it("hits the front-most face under the cursor", () => {
    const layout = viewCubeLayout(640, 400, 0, 0);
    const top = layout.faces.find((f) => f.lbl === "TOP")!;
    const cx = (top.poly[0][0] + top.poly[2][0]) / 2;
    const cy = (top.poly[0][1] + top.poly[2][1]) / 2;
    const hit = hitViewCubeFace(layout, cx, cy);
    expect(hit?.lbl).toBe("TOP");
    expect(hit?.view.ax).toBe(0);
  });
});

describe("preview footer by tab", () => {
  it("orbits on 3D jig and never says pan", () => {
    expect(previewHint("jig3d")).toMatch(/orbit|rotate/i);
    expect(previewHint("jig3d")).not.toMatch(/pan/i);
    expect(previewHint("jig3d")).toMatch(/cube face/i);
  });

  it("keeps pan + drag piece on Template", () => {
    expect(previewHint("template")).toMatch(/pan/i);
    expect(previewHint("template")).toMatch(/piece/i);
  });

  it("pans on laser tabs without the piece-drag line", () => {
    expect(previewHint("laserPocket")).toMatch(/pan/i);
    expect(previewHint("laserPocket")).not.toMatch(/piece/i);
    expect(previewHint("laserBase")).toBe(previewHint("laserPocket"));
  });
});

describe("3D overlay caption", () => {
  it("reports CAD plate size 333×88×7.0", () => {
    const r = rectJob();
    expect(jigHudCaption(r.mesh.length, r.jig.w, r.jig.h, r.solidH)).toBe(
      `drag to rotate · scroll to zoom · click a cube face · ${r.mesh.length.toLocaleString("en-US")} tris · 333×88×7.0 mm`,
    );
  });
});

describe("orbit scale lock", () => {
  it("still uses uniform jigViewScale for the raster camera, including supersample", () => {
    const r = rectJob();
    const cam = jigOrbitCamera(r.jig.w, r.jig.h, r.solidH, r.mesh, 900, 400, 1);
    expect(cam.scX).toBe(cam.scY);
    const ss = jigPreviewSample(900, 400, 1, false);
    const ssCam = jigOrbitCamera(r.jig.w, r.jig.h, r.solidH, r.mesh, ss.w, ss.h, 1);
    expect(ssCam.scX).toBe(ssCam.scY);
    expect(ssCam.sc / cam.sc).toBeCloseTo(ss.w / 900, 5);
    expect(jigViewScale(ss.w, ss.h, 10, 1) / jigViewScale(900, 400, 10, 1)).toBeCloseTo(ss.w / 900, 5);
  });
});
