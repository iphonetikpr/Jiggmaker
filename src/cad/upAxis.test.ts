import { describe, expect, it } from "vitest";
import { bboxOf } from "./geom";
import { generateJig } from "./generate";
import { applyHistorySettings, defaultSettings, newObject, serializeJob } from "./history";
import { meshBBox, meshNonManifoldEdges } from "./mesh";
import { orientPoint } from "./project";
import { makeDraftedPegStl, makeLStl, makeSeatingPlateStl } from "./stl";
import type { JobSettings, Loop } from "../types";
import { summaryJigSize } from "../ui/summary";

function det(up: "z+" | "z-", mirror: boolean): number {
  const x = orientPoint(1, 0, 0, up, 0, mirror);
  const y = orientPoint(0, 1, 0, up, 0, mirror);
  const z = orientPoint(0, 0, 1, up, 0, mirror);
  return (
    x[0] * (y[1] * z[2] - y[2] * z[1]) -
    x[1] * (y[0] * z[2] - y[2] * z[0]) +
    x[2] * (y[0] * z[1] - y[1] * z[0])
  );
}

function center(loop: Loop): [number, number] {
  let x = 0,
    y = 0;
  for (const p of loop) {
    x += p[0];
    y += p[1];
  }
  return [x / loop.length, y / loop.length];
}

function plateJob(up: "z+" | "z-", patch: Partial<JobSettings> = {}, clear = 0.15) {
  const settings: JobSettings = {
    ...defaultSettings(),
    bed: "333x418",
    footprint: "tight",
    scaleComp: false,
    center: false,
    nest: false,
    pocketDepth: 21,
    baseThk: 3,
    ...patch,
  };
  const obj = newObject(0);
  obj.name = "placa";
  obj.stlName = "placa";
  obj.mode = "silhouette";
  obj.up = up;
  obj.clear = clear;
  obj.count = 1;
  const buf = makeSeatingPlateStl();
  return generateJig([obj], { [obj.id]: buf }, settings, {});
}

describe("per-object Z down", () => {
  it("rotates 180° about X and is not a mirror", () => {
    expect(orientPoint(3, 5, 7, "z-", 0, false)).toEqual([3, -5, -7]);
    expect(det("z-", false)).toBeCloseTo(1, 8);
    expect(det("z+", false)).toBeCloseTo(1, 8);
    expect(det("z-", true)).toBeCloseTo(-1, 8);
  });

  it("changes the silhouette of an asymmetric part", () => {
    const buf = makeLStl(8);
    const settings = defaultSettings();
    const up = newObject(0);
    up.stlName = "ell";
    up.mode = "silhouette";
    up.up = "z+";
    const down = { ...up, id: "ell-down", up: "z-" as const };
    const a = generateJig([up], { [up.id]: buf }, settings, {});
    const b = generateJig([down], { [down.id]: buf }, settings, {});
    const sig = (loops: Loop[]) => loops.map((l) => l.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ")).join("|");
    expect(sig(a.placed[0].loops)).not.toBe(sig(b.placed[0].loops));
    expect(a.partHeight).toBeCloseTo(b.partHeight, 5);
  });

  it("pockets only the ribs of a flipped plate, and the template matches", () => {
    const zUp = plateJob("z+");
    const zDown = plateJob("z-");

    expect(zUp.meshPockets[0].loops.length).toBe(1);
    expect(zDown.meshPockets[0].loops.length).toBe(6);
    expect(zDown.partHeight).toBeCloseTo(26.5, 1);
    expect(zDown.solidH).toBeCloseTo(24, 5);
    expect(zDown.solidH).toBeLessThan(zDown.partHeight);
    expect(summaryJigSize(zDown)).toBe("144 × 182 mm");

    const plateArea = 139.7 * 177.8;
    for (const loop of zDown.meshPockets[0].loops) {
      const b = bboxOf([loop]);
      expect(b.w * b.h).toBeLessThan(plateArea * 0.05);
      expect(b.w).toBeGreaterThan(10);
      expect(b.h).toBeGreaterThan(16);
    }

    const cuts = zDown.template.entities.filter((e) => e.layer === "CUT" && e.closed && (e.points?.length || 0) >= 3);
    expect(cuts).toHaveLength(6);
    const pockets = zDown.meshPockets[0].loops;
    for (const cut of cuts) {
      const c = center(cut.points!);
      const hit = pockets.some((loop) => {
        const p = center(loop);
        return Math.hypot(p[0] - c[0], p[1] - c[1]) < 0.6;
      });
      expect(hit).toBe(true);
    }

    const box = meshBBox(zDown.mesh);
    expect(box.minZ).toBeCloseTo(0, 2);
    expect(box.maxZ).toBeCloseTo(zDown.solidH, 2);
    const floorZ = zDown.baseThk - 0.2;
    const floorUp = zDown.mesh.some((t) => {
      const nz = faceNz(t);
      const z = (t[2] + t[5] + t[8]) / 3;
      return nz > 0.9 && Math.abs(z - floorZ) < 0.15;
    });
    expect(floorUp).toBe(true);
    expect(meshNonManifoldEdges(zDown.mesh)).toBe(0);
  });

  it("pockets the widest section inside the seating band, not the contact face", () => {
    // File is 40×40 at z=0 and 10×10 at z=20. Z down seats the 10×10 face.
    // At pocket depth 8 mm the drafted section is 22×22. A bottom-only slice
    // would be ~10 mm and the peg would jam on the way in.
    const settings: JobSettings = {
      ...defaultSettings(),
      bed: "333x418",
      footprint: "tight",
      scaleComp: false,
      center: false,
      nest: false,
      pocketDepth: 8,
      baseThk: 3,
    };
    const obj = newObject(0);
    obj.name = "peg";
    obj.stlName = "peg";
    obj.mode = "silhouette";
    obj.up = "z-";
    obj.clear = 0;
    obj.count = 1;
    const r = generateJig([obj], { [obj.id]: makeDraftedPegStl() }, settings, {});
    expect(r.meshPockets[0].loops.length).toBe(1);
    const b = bboxOf(r.meshPockets[0].loops);
    // 10 + (40-10) * (8/20) = 22 at the top of the band, plus the 0.2 mm/side floor.
    expect(b.w).toBeGreaterThan(21.5);
    expect(b.h).toBeGreaterThan(21.5);
    expect(b.w).toBeLessThan(23.5);
    expect(b.h).toBeLessThan(23.5);
    expect(Math.abs(b.w - b.h)).toBeLessThan(0.8);
  });

  it("sets jig height to base plus pocket depth, even above the part", () => {
    const r = plateJob("z-", { pocketDepth: 40, baseThk: 3 });
    expect(r.solidH).toBeCloseTo(43, 5);
    expect(r.pocketDepth).toBe(40);
    expect(r.baseThk).toBe(3);
    expect(r.solidH).toBeGreaterThan(r.partHeight);
    // The band covers the whole part, so the slot is the full outline.
    expect(r.meshPockets[0].loops.length).toBe(1);
  });

  it("gives narrow contact slots at least 0.2 mm clearance per side", () => {
    const tight = plateJob("z-", {}, 0);
    const wider = plateJob("z-", {}, 0.5);
    const width = (job: ReturnType<typeof plateJob>) => bboxOf([job.meshPockets[0].loops[0]]).w;
    expect(width(tight)).toBeGreaterThan(10.25);
    expect(width(wider)).toBeGreaterThan(width(tight) + 0.35);
  });

  it("drops the old jig-level Z-down setting", () => {
    const restored = applyHistorySettings({ zDownFlip: true, bed: "333x88", nest: true, pocketDepth: "4" });
    expect(restored.bed).toBe("333x88");
    expect(restored.nest).toBe(true);
    expect("zDownFlip" in restored).toBe(false);
    const obj = newObject(0);
    obj.up = "z-";
    const saved = serializeJob("placa", restored, [obj], {}, {});
    expect("zDownFlip" in saved.settings).toBe(false);
    expect(saved.objects[0].up).toBe("z-");
  });
});

function faceNz(t: [number, number, number, number, number, number, number, number, number]): number {
  const ux = t[3] - t[0],
    uy = t[4] - t[1],
    uz = t[5] - t[2];
  const vx = t[6] - t[0],
    vy = t[7] - t[1],
    vz = t[8] - t[2];
  const nz = ux * vy - uy * vx;
  const len = Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, nz) || 1;
  return nz / len;
}
