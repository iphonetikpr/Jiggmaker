import { describe, expect, it } from "vitest";
import { DEFAULTS } from "../constants";
import { generateJig } from "../cad/generate";
import { bboxOf } from "../cad/geom";
import { defaultSettings, newObject } from "../cad/history";
import { toMeshPoint } from "../cad/pose";
import { BED_MINI, fitBedView, pocketLoopsOf } from "./bedPreview";
import {
  jigMeshRadius,
  jigOrbitCamera,
  jigViewScale,
  orbitProject,
  partViewScale,
  projectJigOrbit,
} from "./partView";

function rectJob(moves: Record<string, [number, number]> = {}) {
  const settings = { ...defaultSettings(), scaleComp: false };
  const obj = newObject(0);
  obj.name = "coin";
  obj.mode = "rectangle";
  obj.rectW = 50;
  obj.rectH = 30;
  obj.clear = DEFAULTS.clearance;
  obj.count = 1;
  return generateJig([obj], {}, settings, moves);
}

/** Rotate first, then apply bed scX/scY — the mapping that squashes orbit. */
function anisotropicOrbit(
  x: number,
  y: number,
  z: number,
  cx: number,
  cy: number,
  cz: number,
  az: number,
  ax: number,
  scX: number,
  scY: number,
  viewW: number,
  viewH: number,
): [number, number] {
  const dx = x - cx,
    dy = y - cy,
    dz = z - cz;
  const cs = Math.cos(az),
    sn = Math.sin(az);
  const ca = Math.cos(ax),
    sa = Math.sin(ax);
  const rx = dx * cs - dy * sn;
  const ry = dx * sn + dy * cs;
  const py = ry * ca - dz * sa;
  return [viewW / 2 + rx * scX, viewH / 2 - py * scY];
}

describe("3D jig orbit camera", () => {
  it("keeps scX === scY on a wide Mini 333×88 canvas", () => {
    const r = rectJob();
    expect(r.jig.w).toBe(333);
    expect(r.jig.h).toBe(88);
    const cam = jigOrbitCamera(r.jig.w, r.jig.h, r.solidH, r.mesh, 900, 400, 1);
    const radius = jigMeshRadius(r.mesh, cam.cx, cam.cy, cam.cz);
    expect(cam.scX).toBe(cam.scY);
    expect(cam.scX).toBe(cam.sc);
    expect(cam.sc).toBeCloseTo(jigViewScale(900, 400, radius, 1), 8);
  });

  it("does not reuse the plantilla's anisotropic bed mapping", () => {
    const r = rectJob();
    const W = 900,
      H = 400;
    const cam = jigOrbitCamera(r.jig.w, r.jig.h, r.solidH, r.mesh, W, H, 1);
    const bed = fitBedView(W, H, r.jig.w, r.jig.h, 1, 0, 0, BED_MINI);
    expect(bed.scX).not.toBeCloseTo(bed.scY, 2);
    expect(cam.scX / cam.scY).toBeCloseTo(1, 10);
    const fillRatio = W / r.jig.w / (H / r.jig.h);
    expect(fillRatio).not.toBeCloseTo(1, 1);
    expect(cam.scX / cam.scY).not.toBeCloseTo(fillRatio, 2);
  });

  it("keeps a plate-plane circle circular while yawing", () => {
    const r = rectJob();
    const W = 640,
      H = 400;
    const cam = jigOrbitCamera(r.jig.w, r.jig.h, r.solidH, r.mesh, W, H, 1);
    const R = 20;
    const ax = 0;
    for (const az of [0, 0.4, 0.62, Math.PI / 2, 2.1, 3.5]) {
      const radii: number[] = [];
      for (let i = 0; i < 24; i++) {
        const a = (i / 24) * Math.PI * 2;
        const [sx, sy] = projectJigOrbit(cam.cx + Math.cos(a) * R, cam.cy + Math.sin(a) * R, cam.cz, cam, az, ax, W, H);
        radii.push(Math.hypot(sx - W / 2, sy - H / 2));
      }
      const mean = radii.reduce((s, v) => s + v, 0) / radii.length;
      expect(mean).toBeCloseTo(R * cam.sc, 6);
      for (const d of radii) expect(d).toBeCloseTo(mean, 6);
    }
  });

  it("would squash that circle if bed scX/scY were applied after rotation", () => {
    const r = rectJob();
    const W = 900,
      H = 400;
    const bed = fitBedView(W, H, r.jig.w, r.jig.h, 1, 0, 0, BED_MINI);
    const cx = r.jig.w / 2,
      cy = r.jig.h / 2,
      cz = r.solidH / 2;
    const R = 20;
    const alongX = anisotropicOrbit(cx + R, cy, cz, cx, cy, cz, Math.PI / 2, 0, bed.scX, bed.scY, W, H);
    const alongY = anisotropicOrbit(cx, cy + R, cz, cx, cy, cz, Math.PI / 2, 0, bed.scX, bed.scY, W, H);
    const dX = Math.hypot(alongX[0] - W / 2, alongX[1] - H / 2);
    const dY = Math.hypot(alongY[0] - W / 2, alongY[1] - H / 2);
    expect(Math.abs(dX - dY)).toBeGreaterThan(0.5);
  });

  it("rotates a 50×30 pocket as a rigid rectangle (aspect swaps at 90° yaw)", () => {
    const r = rectJob();
    const loop = pocketLoopsOf(r.placed[0])[0];
    const box = bboxOf([loop]);
    expect(box.w).toBeGreaterThan(box.h);
    const W = 640,
      H = 400;
    const cam = jigOrbitCamera(r.jig.w, r.jig.h, r.solidH, r.mesh, W, H, 1);
    const corners = [
      [box.minX, box.minY],
      [box.maxX, box.minY],
      [box.maxX, box.maxY],
      [box.minX, box.maxY],
    ] as const;
    const aabb = (az: number) => {
      let minX = Infinity,
        minY = Infinity,
        maxX = -Infinity,
        maxY = -Infinity;
      for (const [x, y] of corners) {
        const [mx, my, mz] = toMeshPoint(x, y, r.solidH, r.plateOffset, r.meshXform);
        const [sx, sy] = projectJigOrbit(mx, my, mz, cam, az, 0, W, H);
        if (sx < minX) minX = sx;
        if (sy < minY) minY = sy;
        if (sx > maxX) maxX = sx;
        if (sy > maxY) maxY = sy;
      }
      return { w: maxX - minX, h: maxY - minY };
    };
    const a0 = aabb(0);
    const a90 = aabb(Math.PI / 2);
    expect(a0.w / a0.h).toBeCloseTo(box.w / box.h, 5);
    expect(a90.w / a90.h).toBeCloseTo(box.h / box.w, 5);
    expect(a0.w).toBeCloseTo(a90.h, 5);
    expect(a0.h).toBeCloseTo(a90.w, 5);
  });

  it("projects moved pocket rims with the same uniform camera as the mesh", () => {
    const base = rectJob();
    const r = rectJob({ [base.placed[0].label]: [14, -6] });
    expect(r.placed[0].cx).toBeCloseTo(base.placed[0].cx + 14, 4);
    expect(r.placed[0].cy).toBeCloseTo(base.placed[0].cy - 6, 4);
    const W = 640,
      H = 400;
    const cam = jigOrbitCamera(r.jig.w, r.jig.h, r.solidH, r.mesh, W, H, 1);
    expect(cam.scX).toBe(cam.scY);
    const loop = pocketLoopsOf(r.placed[0])[0];
    for (const az of [0, 0.62, 1.4, Math.PI / 2]) {
      for (const ax of [-0.15, -0.65, -1.5]) {
        for (const [x, y] of loop) {
          const [mx, my, mz] = toMeshPoint(x, y, r.solidH, r.plateOffset, r.meshXform);
          const [sx, sy] = projectJigOrbit(mx, my, mz, cam, az, ax, W, H);
          expect(Number.isFinite(sx)).toBe(true);
          expect(Number.isFinite(sy)).toBe(true);
        }
      }
    }
  });

  it("leaves the orientation card on its own uniform scale", () => {
    const part = partViewScale(260, 220, 10, 1);
    const jig = jigViewScale(260, 220, 10, 1);
    expect(part).not.toBeCloseTo(jig, 6);
    expect(part / jig).toBeCloseTo(0.46 / 0.42, 8);
    const origin = orbitProject(0, 0, 0, 0, 0, 0, 0.4, -0.8, part, 260, 220);
    const x = orbitProject(5, 0, 0, 0, 0, 0, 0.4, -0.8, part, 260, 220);
    const y = orbitProject(0, 5, 0, 0, 0, 0, 0.4, -0.8, part, 260, 220);
    expect(Math.hypot(x[0] - origin[0], x[1] - origin[1])).toBeCloseTo(Math.hypot(y[0] - origin[0], y[1] - origin[1]), 8);
  });
});
