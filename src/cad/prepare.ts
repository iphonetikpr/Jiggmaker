import { OBJECT_COLORS } from "../constants";
import type { HolesMode, JobObject, PreparedObject, StlMesh } from "../types";
import { inflatedRect, originLoops } from "./geom";
import { projectStl, silhouetteLoops } from "./project";
import { parseSTL } from "./stl";

const stlCache = new WeakMap<ArrayBuffer, StlMesh>();

export function meshFromBytes(buf: ArrayBuffer): StlMesh {
  let m = stlCache.get(buf);
  if (!m) {
    m = parseSTL(buf);
    stlCache.set(buf, m);
  }
  return m;
}

export function prepareObject(
  obj: JobObject,
  stlBytes: ArrayBuffer | null,
  index: number,
): PreparedObject {
  const letter = String.fromCharCode(65 + index);
  const color = OBJECT_COLORS[index % OBJECT_COLORS.length];
  const clearance = obj.clear;

  if (stlBytes && obj.stlName) {
    const mesh = meshFromBytes(stlBytes);
    let proj = projectStl(mesh, obj.up, obj.rot, obj.mirror);
    if (obj.auto) {
      const angles = [0, 15, 30, 45, 60, 75, 90];
      let best = obj.rot;
      let bestA = (proj.bbox[2] - proj.bbox[0]) * (proj.bbox[3] - proj.bbox[1]);
      for (const extra of angles) {
        const p = projectStl(mesh, obj.up, obj.rot + extra, obj.mirror);
        const a = (p.bbox[2] - p.bbox[0]) * (p.bbox[3] - p.bbox[1]);
        if (a < bestA - 1e-6) {
          bestA = a;
          best = obj.rot + extra;
          proj = p;
        }
      }
      if (best !== obj.rot) proj = projectStl(mesh, obj.up, best, obj.mirror);
    }

    let loops =
      obj.mode === "rectangle"
        ? inflatedRect(proj.bbox, clearance)
        : silhouetteLoops(proj, clearance);
    if (!loops.length) loops = inflatedRect(proj.bbox, clearance);
    const centered = originLoops(loops);
    const artSrc =
      obj.mode === "rectangle" ? inflatedRect(proj.bbox, 0) : silhouetteLoops(proj, 0);
    const art = originLoops(artSrc.length ? artSrc : centered.loops);
    const artLoops = art.loops.map((l) =>
      l.map(([x, y]) => [x - (art.ox - centered.ox), y - (art.oy - centered.oy)] as [number, number]),
    );

    return {
      id: obj.id,
      name: obj.name || obj.stlName || letter,
      count: Math.max(1, obj.count | 0),
      letter,
      color,
      loops: centered.loops,
      holes: [],
      artLoops,
      artHoles: [],
      holesMode: obj.holes as HolesMode,
      w: centered.w,
      h: centered.h,
      partHeight: proj.partHeight,
    };
  }

  const w = Math.max(0.5, obj.rectW);
  const h = Math.max(0.5, obj.rectH);
  const loops = inflatedRect([0, 0, w, h], clearance);
  const centered = originLoops(loops);
  const art = originLoops(inflatedRect([0, 0, w, h], 0));

  return {
    id: obj.id,
    name: obj.name || "rect",
    count: Math.max(1, obj.count | 0),
    letter,
    color,
    loops: centered.loops,
    holes: [],
    artLoops: art.loops,
    artHoles: [],
    holesMode: obj.holes as HolesMode,
    w: centered.w,
    h: centered.h,
    partHeight: 8,
  };
}
