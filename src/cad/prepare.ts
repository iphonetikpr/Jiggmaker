import { DEFAULTS, OBJECT_COLORS } from "../constants";
import type { HolesMode, JobObject, Loop, PreparedObject, StlMesh } from "../types";
import { inflatedRect, originLoops, translateLoop } from "./geom";
import { solidHeight } from "./mesh";
import { clipToDepth, loopsArea, projectStl, silhouetteLoops, type Projected } from "./project";
import { parseSTL } from "./stl";

export interface PrepareOpts {
  pocketDepth: number;
  baseThk: number;
}

/**
 * Keep the extruded jig shorter than the part. A requested pocket that would
 * bury the part is shortened so solid height stays 0.05 mm under part height.
 */
export function effectivePocketDepth(requested: number, baseThk: number, partHeight: number): number {
  if (!(partHeight > 1) || !(requested > 0)) return requested;
  if (solidHeight(baseThk, requested) < partHeight - 1e-6) return requested;
  const base = baseThk > 0 ? baseThk : 0;
  const capped = partHeight - base - 0.05;
  if (capped < 0.4) return Math.min(requested, Math.max(0.2, capped));
  return Math.min(requested, capped);
}

function inFrame(loops: Loop[], ox: number, oy: number): Loop[] {
  return loops.map((l) => translateLoop(l, -ox, -oy));
}

/**
 * Pocket loops in the full-part frame. When the bottom `depth` mm is a much
 * smaller shape than the whole projection (feet, ribs), that contact band
 * becomes the pocket and the part bbox stays the layout footprint.
 */
function seatLoops(proj: Projected, mode: JobObject["mode"], clearance: number, pocketDepth: number, baseThk: number) {
  const fullClear = mode === "rectangle" ? inflatedRect(proj.bbox, clearance) : silhouetteLoops(proj, clearance);
  const fullArt = mode === "rectangle" ? inflatedRect(proj.bbox, 0) : silhouetteLoops(proj, 0);
  const fallback = fullClear.length ? fullClear : inflatedRect(proj.bbox, clearance);
  const centered = originLoops(fallback);
  const artSrc = fullArt.length ? fullArt : centered.loops;
  const art = originLoops(artSrc);
  let loops = centered.loops;
  let artLoops = art.loops.map((l) => translateLoop(l, art.ox - centered.ox, art.oy - centered.oy));

  const depth = effectivePocketDepth(pocketDepth, baseThk, proj.partHeight);
  if (mode === "silhouette" && depth > 0 && depth < proj.partHeight - 0.05) {
    const band = clipToDepth(proj, depth);
    if (band.tris.length) {
      const bandArt = silhouetteLoops(band, 0);
      const fullA = loopsArea(fullArt.length ? fullArt : fallback);
      const bandA = loopsArea(bandArt);
      if (bandArt.length && fullA > 0 && bandA < 0.97 * fullA) {
        const slotClear = Math.max(clearance, DEFAULTS.slotClearance);
        // A plate-sized grid is coarser than 0.2 mm, which would swallow the clearance.
        const bandPocket = silhouetteLoops(band, slotClear, slotClear / 2);
        const pockets = bandPocket.length ? bandPocket : bandArt;
        loops = inFrame(pockets, centered.ox, centered.oy);
        artLoops = inFrame(bandArt, centered.ox, centered.oy);
      }
    }
  }

  return { loops, artLoops, centered };
}

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
  opts?: PrepareOpts,
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

    const seated = seatLoops(proj, obj.mode, clearance, opts?.pocketDepth ?? 4, opts?.baseThk ?? 3);
    const loops = seated.loops;
    const centered = seated.centered;
    const artLoops = seated.artLoops;

    return {
      id: obj.id,
      name: obj.name || obj.stlName || letter,
      count: Math.max(1, obj.count | 0),
      letter,
      color,
      loops,
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
  const artLoops = art.loops.map((l) => translateLoop(l, art.ox - centered.ox, art.oy - centered.oy));

  return {
    id: obj.id,
    name: obj.name || "rect",
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
    partHeight: 8,
  };
}
