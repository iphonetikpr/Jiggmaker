import { describe, expect, it } from "vitest";
import { DEFAULTS, POCKET_DEPTH_EXTRA } from "../constants";
import { jigOrbitCamera, projectJigOrbit } from "../ui/partView";
import { pocketLoopsOf, silhouetteLoopsOf } from "../ui/bedPreview";
import { bboxOf, pointInPoly } from "./geom";
import { generateJig } from "./generate";
import { defaultSettings, newObject } from "./history";
import { piecePose, toMeshPoint } from "./pose";
import { makeLStl } from "./stl";
import type { Tri } from "../types";

function rectJob(moves: Record<string, [number, number]> = {}, patch: Partial<Parameters<typeof generateJig>[2]> = {}) {
  const settings = { ...defaultSettings(), scaleComp: false, ...patch };
  const obj = newObject(0);
  obj.name = "coin";
  obj.mode = "rectangle";
  obj.rectW = 50;
  obj.rectH = 30;
  obj.clear = DEFAULTS.clearance;
  obj.count = 1;
  return generateJig([obj], {}, settings, moves);
}

function pointInTriXY(px: number, py: number, t: Tri): boolean {
  const ax = t[0],
    ay = t[1],
    bx = t[3],
    by = t[4],
    cx = t[6],
    cy = t[7];
  const v0x = cx - ax,
    v0y = cy - ay;
  const v1x = bx - ax,
    v1y = by - ay;
  const v2x = px - ax,
    v2y = py - ay;
  const dot00 = v0x * v0x + v0y * v0y;
  const dot01 = v0x * v1x + v0y * v1y;
  const dot02 = v0x * v2x + v0y * v2y;
  const dot11 = v1x * v1x + v1y * v1y;
  const dot12 = v1x * v2x + v1y * v2y;
  const den = dot00 * dot11 - dot01 * dot01;
  if (Math.abs(den) < 1e-12) return false;
  const u = (dot11 * dot02 - dot01 * dot12) / den;
  const v = (dot00 * dot12 - dot01 * dot02) / den;
  return u >= -1e-5 && v >= -1e-5 && u + v <= 1 + 1e-5;
}

function meshCoversXY(mesh: Tri[], x: number, y: number, z: number, zTol = 0.2): boolean {
  return mesh.some((t) => {
    if (Math.abs(t[2] - z) > zTol || Math.abs(t[5] - z) > zTol || Math.abs(t[8] - z) > zTol) return false;
    return pointInTriXY(x, y, t);
  });
}

describe("piece + pocket share one pose", () => {
  it("nests the art silhouette inside the pocket (clearance inset)", () => {
    const r = rectJob();
    const p = r.placed[0];
    const pocket = bboxOf(p.loops);
    const art = bboxOf(p.art);
    expect(art.minX).toBeGreaterThan(pocket.minX - 1e-6);
    expect(art.minY).toBeGreaterThan(pocket.minY - 1e-6);
    expect(art.maxX).toBeLessThan(pocket.maxX + 1e-6);
    expect(art.maxY).toBeLessThan(pocket.maxY + 1e-6);
    expect(art.minX - pocket.minX).toBeCloseTo(DEFAULTS.clearance, 5);
    expect(pocket.maxX - art.maxX).toBeCloseTo(DEFAULTS.clearance, 5);
    expect(piecePose(p).pocket).toBe(p.loops);
    expect(piecePose(p).art).toBe(p.art);
  });

  it("moves pocket, art, template CUT, laser CUT and mesh by the same delta", () => {
    const base = rectJob();
    const label = base.placed[0].label;
    const moved = rectJob({ [label]: [14, -6] });
    const b = base.placed[0];
    const m = moved.placed[0];
    const dLoop = bboxOf(pocketLoopsOf(m));
    const dArt = bboxOf(silhouetteLoopsOf(m));
    const bLoop = bboxOf(pocketLoopsOf(b));
    const bArt = bboxOf(silhouetteLoopsOf(b));
    expect(dLoop.minX - bLoop.minX).toBeCloseTo(14, 5);
    expect(dLoop.minY - bLoop.minY).toBeCloseTo(-6, 5);
    expect(dArt.minX - bArt.minX).toBeCloseTo(14, 5);
    expect(dArt.minY - bArt.minY).toBeCloseTo(-6, 5);
    expect(m.cx - b.cx).toBeCloseTo(14, 5);
    expect(m.cy - b.cy).toBeCloseTo(-6, 5);

    const cut = moved.template.entities.find((e) => e.layer === "CUT" && e.points);
    const cutBox = bboxOf([cut!.points!]);
    expect(cutBox.minX).toBeCloseTo(dArt.minX, 4);

    const laserCut = moved.laser.pocketEntities.find((e) => e.layer === "CUT" && e.points && e.points.length > 3);
    const laserBox = bboxOf([laserCut!.points!]);
    expect(laserBox.minX).toBeCloseTo(dLoop.minX + moved.plateOffset.x, 4);
    expect(laserBox.minY).toBeCloseTo(dLoop.minY + moved.plateOffset.y, 4);

    const [mx, my, mz] = toMeshPoint(m.cx, m.cy, moved.solidH, moved.plateOffset, moved.meshXform);
    expect(meshCoversXY(moved.mesh, mx, my, mz)).toBe(false);
    const floorZ = DEFAULTS.baseThk - POCKET_DEPTH_EXTRA;
    const [fx, fy, fz] = toMeshPoint(m.cx, m.cy, floorZ, moved.plateOffset, moved.meshXform);
    expect(meshCoversXY(moved.mesh, fx, fy, fz)).toBe(true);
  });

  it("rebuilds pocket and art together when orientation changes", () => {
    const buf = makeLStl(8);
    const obj = newObject(0);
    obj.mode = "silhouette";
    obj.stlName = "ell";
    obj.count = 1;
    obj.up = "z+";
    obj.rot = 0;
    obj.clear = DEFAULTS.clearance;
    const settings = { ...defaultSettings(), scaleComp: false };
    const a = generateJig([obj], { [obj.id]: buf }, settings, {});
    obj.rot = 90;
    const b = generateJig([obj], { [obj.id]: buf }, settings, {});
    const artA = bboxOf(silhouetteLoopsOf(a.placed[0]));
    const artB = bboxOf(silhouetteLoopsOf(b.placed[0]));
    const pokA = bboxOf(pocketLoopsOf(a.placed[0]));
    const pokB = bboxOf(pocketLoopsOf(b.placed[0]));
    expect(artA.w).toBeGreaterThan(artA.h);
    expect(artB.h).toBeGreaterThan(artB.w);
    expect(Math.sign(artA.w - artA.h)).toBe(Math.sign(pokA.w - pokA.h));
    expect(Math.sign(artB.w - artB.h)).toBe(Math.sign(pokB.w - pokB.h));
    const insetA = artA.minX - pokA.minX;
    const insetB = artB.minX - pokB.minX;
    expect(insetA).toBeGreaterThan(0);
    expect(insetB).toBeGreaterThan(0);
  });

  it("keeps a hole in the 3D top face so the pocket cannot disappear", () => {
    const r = rectJob();
    const p = r.placed[0];
    const [tx, ty, tz] = toMeshPoint(p.cx, p.cy, r.solidH, r.plateOffset, r.meshXform);
    expect(meshCoversXY(r.mesh, tx, ty, tz)).toBe(false);
    expect(pointInPoly([p.cx, p.cy], p.loops[0])).toBe(true);
    const [ox, oy] = [8, 8];
    const [px, py, pz] = toMeshPoint(ox, oy, r.solidH, r.plateOffset, r.meshXform);
    expect(meshCoversXY(r.mesh, px, py, pz)).toBe(true);
  });

  it("projects pocket rims with the mesh orbit matrix at every angle", () => {
    const r = rectJob();
    const loop = pocketLoopsOf(r.placed[0])[0];
    const cam = jigOrbitCamera(r.jig.w, r.jig.h, r.solidH, r.mesh, 640, 400, 1);
    expect(cam.scX).toBe(cam.scY);
    for (const az of [0, 0.62, 1.4, 2.6, 3.5]) {
      for (const ax of [-0.15, -0.65, -1.5, -2.4]) {
        for (const [x, y] of loop) {
          const [mx, my, mz] = toMeshPoint(x, y, r.solidH, r.plateOffset, r.meshXform);
          const [sx, sy, sz] = projectJigOrbit(mx, my, mz, cam, az, ax, 640, 400);
          expect(Number.isFinite(sx)).toBe(true);
          expect(Number.isFinite(sy)).toBe(true);
          expect(Number.isFinite(sz)).toBe(true);
          expect(sx).toBeGreaterThan(-2000);
          expect(sx).toBeLessThan(3000);
          expect(sy).toBeGreaterThan(-2000);
          expect(sy).toBeLessThan(3000);
        }
      }
    }
  });
});
