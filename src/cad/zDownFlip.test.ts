import { describe, expect, it } from "vitest";
import {
  ORIGIN_MARK_DEPTH,
  POCKET_MOUTH_CHAMFER,
  POCKET_MOUTH_CHAMFER_THIN,
  POCKET_MOUTH_THIN_WALL,
} from "../constants";
import type { JobSettings, Tri } from "../types";
import { templateSvg } from "./export";
import { generateJig } from "./generate";
import { bboxOf } from "./geom";
import { applyHistorySettings, defaultSettings, newObject, serializeJob } from "./history";
import { meshBBox, meshNonManifoldEdges } from "./mesh";
import { buildSplitMeshes } from "./split";
import { toSVG } from "./svg";
import { summaryZDownPill } from "../ui/summary";
import { originMarkLoop, zDownFlipMap } from "./zDownFlip";

function job(patch: Partial<JobSettings> = {}, count = 1, w = 18, h = 18) {
  const settings: JobSettings = { ...defaultSettings(), scaleComp: false, ...patch };
  const obj = newObject(0);
  obj.name = "cap";
  obj.count = count;
  obj.rectW = w;
  obj.rectH = h;
  obj.mode = "rectangle";
  obj.clear = 0;
  return generateJig([obj], {}, settings, {});
}

function signedVolume(tris: Tri[]): number {
  let v = 0;
  for (const t of tris) {
    const ax = t[0],
      ay = t[1],
      az = t[2];
    const bx = t[3],
      by = t[4],
      bz = t[5];
    const cx = t[6],
      cy = t[7],
      cz = t[8];
    v += ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx);
  }
  return v / 6;
}

function hasVertex(tris: Tri[], x: number, y: number, z: number, eps = 1e-3): boolean {
  for (const t of tris) {
    for (let i = 0; i < 9; i += 3) {
      if (Math.hypot(t[i] - x, t[i + 1] - y, t[i + 2] - z) <= eps) return true;
    }
  }
  return false;
}

function sliceXs(mesh: Tri[], y: number, z: number): number[] {
  const xs: number[] = [];
  const atZ = (a: number[], b: number[]): [number, number] | null => {
    const dz = b[2] - a[2];
    if (Math.abs(dz) < 1e-8) return null;
    const t = (z - a[2]) / dz;
    if (t < -1e-4 || t > 1 + 1e-4) return null;
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  };
  for (const tri of mesh) {
    const vs = [
      [tri[0], tri[1], tri[2]],
      [tri[3], tri[4], tri[5]],
      [tri[6], tri[7], tri[8]],
    ];
    const pts: Array<[number, number]> = [];
    for (let i = 0; i < 3; i++) {
      const p = atZ(vs[i], vs[(i + 1) % 3]);
      if (p) pts.push(p);
    }
    if (pts.length < 2) continue;
    const a = pts[0];
    const b = pts[pts.length - 1];
    const dy = b[1] - a[1];
    if (Math.abs(dy) < 1e-8) continue;
    const t = (y - a[1]) / dy;
    if (t < -1e-3 || t > 1 + 1e-3) continue;
    xs.push(a[0] + (b[0] - a[0]) * t);
  }
  xs.sort((p, q) => p - q);
  const uniq: number[] = [];
  for (const x of xs) {
    if (!uniq.length || Math.abs(x - uniq[uniq.length - 1]) > 0.03) uniq.push(x);
  }
  return uniq;
}

/** Width of the void that contains the pocket center, at a horizontal slice. */
function openingWidth(mesh: Tri[], cx: number, cy: number, z: number): number | null {
  const xs = sliceXs(mesh, cy, z);
  for (let i = 0; i < xs.length - 1; i++) {
    if (xs[i] < cx - 1e-6 && xs[i + 1] > cx + 1e-6) return xs[i + 1] - xs[i];
  }
  return null;
}

function det3(c0: number[], c1: number[], c2: number[]): number {
  return (
    c0[0] * (c1[1] * c2[2] - c1[2] * c2[1]) -
    c0[1] * (c1[0] * c2[2] - c1[2] * c2[0]) +
    c0[2] * (c1[0] * c2[1] - c1[1] * c2[0])
  );
}

describe("Z-down flip", () => {
  it("is off by default and round-trips in saved jobs", () => {
    expect(defaultSettings().zDownFlip).toBe(false);
    expect(POCKET_MOUTH_CHAMFER).toBe(0.4);
    expect(POCKET_MOUTH_CHAMFER_THIN).toBe(0.3);
    expect(POCKET_MOUTH_THIN_WALL).toBeGreaterThan(POCKET_MOUTH_CHAMFER * 2);
    const settings = defaultSettings();
    settings.zDownFlip = true;
    const saved = serializeJob("flip", settings, [newObject(0)], {}, {});
    expect(saved.settings.zDownFlip).toBe(true);
    expect(applyHistorySettings(saved.settings).zDownFlip).toBe(true);
    expect(applyHistorySettings({ bed: "333x88", nest: true }).zDownFlip).toBe(false);
  });

  it("rotates the STL about Y (det +1), seats min Z at 0, and keeps the bounding box", () => {
    const off = job({ zDownFlip: false });
    const on = job({ zDownFlip: true });
    const bo = meshBBox(off.mesh);
    const bn = meshBBox(on.mesh);
    expect(bn.minZ).toBeCloseTo(0, 6);
    expect(bn.maxX - bn.minX).toBeCloseTo(bo.maxX - bo.minX, 4);
    expect(bn.maxY - bn.minY).toBeCloseTo(bo.maxY - bo.minY, 4);
    expect(bn.maxZ - bn.minZ).toBeCloseTo(bo.maxZ - bo.minZ, 4);

    const corners: Array<[number, number, number]> = [
      [bo.minX, bo.minY, bo.minZ],
      [bo.maxX, bo.minY, bo.minZ],
      [bo.minX, bo.maxY, bo.minZ],
      [bo.minX, bo.minY, bo.maxZ],
    ];
    const images = corners.map(([x, y, z]) => zDownFlipMap(x, y, z, bo));
    for (const [x, y, z] of corners) expect(hasVertex(off.mesh, x, y, z)).toBe(true);
    for (const [x, y, z] of images) expect(hasVertex(on.mesh, x, y, z)).toBe(true);

    const e1 = [corners[1][0] - corners[0][0], corners[1][1] - corners[0][1], corners[1][2] - corners[0][2]];
    const e2 = [corners[2][0] - corners[0][0], corners[2][1] - corners[0][1], corners[2][2] - corners[0][2]];
    const e3 = [corners[3][0] - corners[0][0], corners[3][1] - corners[0][1], corners[3][2] - corners[0][2]];
    const f1 = [images[1][0] - images[0][0], images[1][1] - images[0][1], images[1][2] - images[0][2]];
    const f2 = [images[2][0] - images[0][0], images[2][1] - images[0][1], images[2][2] - images[0][2]];
    const f3 = [images[3][0] - images[0][0], images[3][1] - images[0][1], images[3][2] - images[0][2]];
    const col = (f: number[], e: number[]) => {
      const len = Math.hypot(e[0], e[1], e[2]);
      const axis = e.map((v) => v / len);
      const along = f[0] * axis[0] + f[1] * axis[1] + f[2] * axis[2];
      return [along / len, f[0] - along * axis[0], f[1] - along * axis[1]];
    };
    // Axis-aligned edges: the linear map is the matrix with columns f_i / e_i.
    const c0 = [f1[0] / e1[0], f1[1] / e1[0], f1[2] / e1[0]];
    const c1 = [f2[0] / e2[1], f2[1] / e2[1], f2[2] / e2[1]];
    const c2 = [f3[0] / e3[2], f3[1] / e3[2], f3[2] / e3[2]];
    expect(col(f1, e1)[0]).toBeCloseTo(-1, 6);
    const det = det3(c0, c1, c2);
    expect(det).toBeCloseTo(1, 6);
    expect(det).toBeGreaterThan(0);
    expect(c0[0]).toBeCloseTo(-1, 6);
    expect(c1[1]).toBeCloseTo(1, 6);
    expect(c2[2]).toBeCloseTo(-1, 6);
    expect(c0[1]).toBeCloseTo(0, 6);
    expect(c1[0]).toBeCloseTo(0, 6);

    expect(Math.sign(signedVolume(on.mesh))).toBe(Math.sign(signedVolume(off.mesh)));
    expect(meshNonManifoldEdges(on.mesh)).toBe(0);
    expect(meshNonManifoldEdges(off.mesh)).toBe(0);

    const scaledOff = job({ zDownFlip: false, scaleComp: true });
    const scaledOn = job({ zDownFlip: true, scaleComp: true });
    const so = meshBBox(scaledOff.mesh);
    const sn = meshBBox(scaledOn.mesh);
    expect(sn.minZ).toBeCloseTo(0, 5);
    expect(sn.maxX - sn.minX).toBeCloseTo(so.maxX - so.minX, 3);
    expect(sn.maxY - sn.minY).toBeCloseTo(so.maxY - so.minY, 3);
    expect(sn.maxZ - sn.minZ).toBeCloseTo(so.maxZ - so.minZ, 3);
  });

  it("leaves the Template SVG unchanged", () => {
    const off = job({ zDownFlip: false, paintSafe: true });
    const on = job({ zDownFlip: true, paintSafe: true });
    expect(templateSvg(on, "cap_Mini_1up").data).toBe(templateSvg(off, "cap_Mini_1up").data);
    const laserOff = toSVG(off.jig.w, off.jig.h, off.laser.pocketEntities);
    const laserOn = toSVG(on.jig.w, on.jig.h, on.laser.pocketEntities);
    expect(laserOn).toBe(laserOff);
    expect(summaryZDownPill(on)).toBe("Z-down");
    expect(summaryZDownPill(off)).toBeNull();
  });

  it("chamfers the bed mouth only when Z-down flip is on", () => {
    const off = job({ zDownFlip: false });
    const on = job({ zDownFlip: true });
    const piece = on.placed[0];
    const bb = bboxOf(piece.loops);
    const nominal = bb.w;
    expect(nominal).toBeCloseTo(18, 5);
    const box = meshBBox(on.mesh);
    const cx = box.minX + box.maxX - (bb.minX + bb.maxX) / 2;
    const cy = (bb.minY + bb.maxY) / 2;

    const mouth = openingWidth(on.mesh, cx, cy, 0.05);
    const above = openingWidth(on.mesh, cx, cy, POCKET_MOUTH_CHAMFER + 0.3);
    expect(mouth).not.toBeNull();
    expect(above).not.toBeNull();
    const wide = nominal + 2 * (POCKET_MOUTH_CHAMFER - 0.05);
    expect(mouth!).toBeCloseTo(wide, 1);
    expect(above!).toBeCloseTo(nominal, 1);
    expect(mouth!).toBeGreaterThan(nominal + 0.5);
    expect(above!).toBeLessThan(nominal + 0.15);

    const top = meshBBox(off.mesh).maxZ;
    const sharp = openingWidth(off.mesh, (bb.minX + bb.maxX) / 2, cy, top - 0.05);
    expect(sharp).not.toBeNull();
    expect(sharp!).toBeCloseTo(nominal, 1);
    expect(sharp!).toBeLessThan(nominal + 0.15);
  });

  it("uses the thin-wall chamfer when pockets sit close together", () => {
    const on = job({ zDownFlip: true, spacingX: 1, nest: false }, 2);
    expect(on.placed.length).toBe(2);
    const box = meshBBox(on.mesh);
    for (const piece of on.placed) {
      const bb = bboxOf(piece.loops);
      const gap = loopGapBetween(on.placed.map((p) => bboxOf(p.loops)));
      expect(gap).toBeLessThan(POCKET_MOUTH_THIN_WALL);
      const cx = box.minX + box.maxX - (bb.minX + bb.maxX) / 2;
      const cy = (bb.minY + bb.maxY) / 2;
      const mouth = openingWidth(on.mesh, cx, cy, 0.05);
      expect(mouth).not.toBeNull();
      const wide = bb.w + 2 * (POCKET_MOUTH_CHAMFER_THIN - 0.05);
      expect(mouth!).toBeCloseTo(wide, 1);
      expect(Math.abs(mouth! - (bb.w + 2 * (POCKET_MOUTH_CHAMFER - 0.05)))).toBeGreaterThan(0.15);
    }
    expect(meshNonManifoldEdges(on.mesh)).toBe(0);
  });

  it("keeps an origin mark on the top face after the flip", () => {
    const off = job({ zDownFlip: false });
    const on = job({ zDownFlip: true });
    const mark = originMarkLoop(0);
    const [x, y] = mark[0];
    const box = meshBBox(on.mesh);
    const axis = { minX: box.minX, maxX: box.maxX, minZ: box.minZ, maxZ: box.maxZ };
    const top = zDownFlipMap(x, y, 0, axis);
    const floor = zDownFlipMap(x, y, ORIGIN_MARK_DEPTH, axis);
    expect(top[2]).toBeCloseTo(box.maxZ, 4);
    expect(floor[2]).toBeLessThan(box.maxZ - 0.5);
    expect(floor[2]).toBeGreaterThan(box.minZ + 0.5);
    expect(hasVertex(on.mesh, top[0], top[1], top[2])).toBe(true);
    expect(hasVertex(on.mesh, floor[0], floor[1], floor[2])).toBe(true);
    expect(hasVertex(off.mesh, x, y, ORIGIN_MARK_DEPTH, 0.05)).toBe(false);
    expect(meshNonManifoldEdges(on.mesh)).toBe(0);
  });

  it("flips split STLs onto the bed without opening the mesh", () => {
    const patch = { splitPlate: true, maxPrintBed: 200, scaleComp: false } as const;
    const off = job({ ...patch, zDownFlip: false }, 2, 40, 20);
    const on = job({ ...patch, zDownFlip: true }, 2, 40, 20);
    expect(on.splits.length).toBeGreaterThanOrEqual(2);
    const a = buildSplitMeshes(off);
    const b = buildSplitMeshes(on);
    expect(b.length).toBe(a.length);
    for (let i = 0; i < b.length; i++) {
      const ba = meshBBox(a[i].mesh);
      const bb = meshBBox(b[i].mesh);
      expect(bb.minZ).toBeCloseTo(0, 5);
      expect(bb.maxX - bb.minX).toBeCloseTo(ba.maxX - ba.minX, 3);
      expect(bb.maxY - bb.minY).toBeCloseTo(ba.maxY - ba.minY, 3);
      expect(bb.maxZ - bb.minZ).toBeCloseTo(ba.maxZ - ba.minZ, 3);
      expect(meshNonManifoldEdges(b[i].mesh)).toBe(0);
    }
  });
});

function loopGapBetween(boxes: Array<{ minX: number; maxX: number; minY: number; maxY: number }>): number {
  let gap = Infinity;
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i];
      const b = boxes[j];
      const dx = Math.max(0, Math.max(a.minX, b.minX) - Math.min(a.maxX, b.maxX));
      const dy = Math.max(0, Math.max(a.minY, b.minY) - Math.min(a.maxY, b.maxY));
      gap = Math.min(gap, Math.hypot(dx, dy));
    }
  }
  return gap;
}
