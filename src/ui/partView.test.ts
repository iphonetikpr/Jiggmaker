import { describe, expect, it } from "vitest";
import { makeBoxStl, parseSTL } from "../cad/stl";
import {
  PART_VIEW,
  orbitProject,
  orientedPartBounds,
  partViewScale,
  renderOrientedMesh,
} from "./partView";

describe("orientation camera", () => {
  it("keeps a 260×220 canvas and a uniform scale", () => {
    expect(PART_VIEW.w).toBe(260);
    expect(PART_VIEW.h).toBe(220);
    const sc = partViewScale(260, 220, 10, 1);
    expect(sc).toBeCloseTo((0.46 * 220) / 10, 8);
    expect(partViewScale(520, 440, 10, 1)).toBeCloseTo(sc * 2, 8);
  });

  it("projects with one scale on X and Y (no squash)", () => {
    const sc = 12;
    const origin = orbitProject(0, 0, 0, 0, 0, 0, 0.4, -0.8, sc, 260, 220);
    const x = orbitProject(5, 0, 0, 0, 0, 0, 0.4, -0.8, sc, 260, 220);
    const y = orbitProject(0, 5, 0, 0, 0, 0, 0.4, -0.8, sc, 260, 220);
    const z = orbitProject(0, 0, 5, 0, 0, 0, 0.4, -0.8, sc, 260, 220);
    const dX = Math.hypot(x[0] - origin[0], x[1] - origin[1]);
    const dY = Math.hypot(y[0] - origin[0], y[1] - origin[1]);
    const dZ = Math.hypot(z[0] - origin[0], z[1] - origin[1]);
    const world = 5 * sc;
    expect(dX).toBeLessThanOrEqual(world + 1e-6);
    expect(dY).toBeLessThanOrEqual(world + 1e-6);
    expect(dZ).toBeLessThanOrEqual(world + 1e-6);
    expect(dX + dY + dZ).toBeGreaterThan(world);
    const wide = orbitProject(5, 0, 0, 0, 0, 0, 0.4, -0.8, sc, 520, 220);
    const wideO = orbitProject(0, 0, 0, 0, 0, 0, 0.4, -0.8, sc, 520, 220);
    expect(wide[0] - wideO[0]).toBeCloseTo(x[0] - origin[0], 8);
    expect(wide[1] - wideO[1]).toBeCloseTo(x[1] - origin[1], 8);
  });

  it("rasterizes a cube without stretching it into the canvas", () => {
    const mesh = parseSTL(makeBoxStl(20, 20, 20));
    const bounds = orientedPartBounds(mesh, "z+", 0, false);
    expect(bounds.count).toBe(12);
    expect(bounds.radius).toBeGreaterThan(10);
    const frame = renderOrientedMesh(mesh, "z+", 0, false, 260, 220, 0.7, -0.7, 1, [200, 200, 200], [0, 0, 0]);
    expect(frame.w).toBe(260);
    expect(frame.h).toBe(220);
    let minX = frame.w,
      minY = frame.h,
      maxX = 0,
      maxY = 0,
      filled = 0;
    for (let y = 0; y < frame.h; y++) {
      for (let x = 0; x < frame.w; x++) {
        const i = (y * frame.w + x) * 4;
        if (frame.data[i] === 0 && frame.data[i + 1] === 0 && frame.data[i + 2] === 0) continue;
        filled++;
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
    expect(filled).toBeGreaterThan(800);
    const bw = maxX - minX + 1;
    const bh = maxY - minY + 1;
    expect(bw / bh).toBeGreaterThan(0.7);
    expect(bw / bh).toBeLessThan(1.45);
    expect(Math.abs(bw - bh)).toBeLessThan(90);
    expect(bw).toBeLessThan(250);
  });
});
