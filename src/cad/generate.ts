import { FRAME_PLATE, PICK_OUT_SIDE_MM } from "../constants";
import type { BedSize, Entity, JobObject, JobSettings, JigResult, Loop, PlacedPiece } from "../types";
import { formatMm } from "./format";
import { bboxOf, pointInPoly, pointSegDistance, rectLoop, roundedRectLoop, translateLoop } from "./geom";
import { applyMoves, assessPlacement, footprintOf, packObjects } from "./layout";
import { extrudePlate, meshSingleIncidenceEdges, plateMeshXform, solidHeight } from "./mesh";
import { bedFromSettings, plateLabel } from "./filename";
import { paintSafeGuideEntity, paintSafeLoops, templateOuterLoops } from "./paintSafe";
import { leadInDepth } from "./leadIn";
import { applyFingerNotches } from "./notch";
import { prepareObject } from "./prepare";
import { buildSplitMeshes, planPlateSplits } from "./split";
import { wallBlockers } from "./walls";

/** Keep a margin box inside [0, limit]. A box larger than the limit fills it. */
function clampSpan(origin: number, size: number, limit: number): { origin: number; size: number } {
  if (!(limit > 0)) return { origin: 0, size: Math.max(0, size) };
  if (size >= limit - 1e-9) return { origin: 0, size: limit };
  let o = origin;
  if (o < 0) o = 0;
  if (o + size > limit) o = limit - size;
  return { origin: o, size };
}

function addReg(entities: Entity[]) {
  entities.push({ layer: "REG", points: [
    [3, 3],
    [9, 3],
  ], strokeWidth: 0.35 });
  entities.push({ layer: "REG", points: [
    [3, 3],
    [3, 9],
  ], strokeWidth: 0.35 });
}

function outlineEntity(loop: Loop): Entity {
  return { layer: "OUTLINE", points: loop, closed: true, strokeWidth: 0.25 };
}

/** Circle of radius r stays at least `side` mm inside the pocket, and not inside a boss. */
function pickFits(loops: Loop[], holes: Loop[], cx: number, cy: number, r: number, side: number): boolean {
  const host = loops.find((loop) => pointInPoly([cx, cy], loop));
  if (!host) return false;
  if (holes.some((loop) => pointInPoly([cx, cy], loop))) return false;
  const need = r + side;
  const rings = [host, ...holes];
  for (const loop of rings) {
    for (let i = 0; i < loop.length; i++) {
      const a = loop[i];
      const b = loop[(i + 1) % loop.length];
      if (pointSegDistance([cx, cy], a, b) < need - 1e-4) return false;
    }
  }
  return true;
}

export function generateJig(
  objects: JobObject[],
  stlMap: Record<string, ArrayBuffer | null>,
  settings: JobSettings,
  moves: Record<string, [number, number]> = {},
): JigResult {
  const bed = bedFromSettings(settings);
  const frameOn = settings.bed === "333x88" && settings.useAdapter;
  const prepped = objects.map((o, i) =>
    prepareObject(o, stlMap[o.id] || null, i, { pocketDepth: settings.pocketDepth }),
  );
  const pocketDepth = settings.pocketDepth;
  const pack = packObjects(prepped, bed.w, bed.h, settings);
  applyMoves(pack.placed, moves, bed.w, bed.h);
  const notchWarnings = applyFingerNotches(
    pack.placed,
    objects.map((o) => !!o.notch),
    bed,
  );
  // Moves (imported or dragged) land after packing. Re-check quantities, margins, and overlap.
  const layout = assessPlacement(
    pack.placed,
    prepped.map((o, index) => ({
      index,
      letter: o.letter,
      count: o.count,
      w: objects[index]?.stlName ? o.w : objects[index].rectW,
      h: objects[index]?.stlName ? o.h : objects[index].rectH,
    })),
    { bedW: bed.w, bedH: bed.h, marginX: settings.marginX, marginY: settings.marginY, bedName: bed.name },
  );

  let jigW = bed.w;
  let jigH = bed.h;
  let cornerR = 0;
  let plateDx = 0;
  let plateDy = 0;
  const placed = pack.placed.map((p) => ({ ...p }));
  const frameDx = (FRAME_PLATE.w - bed.w) / 2;
  const frameDy = (FRAME_PLATE.h - bed.h) / 2;

  if (frameOn && !(settings.footprint === "tight" && placed.length)) {
    jigW = FRAME_PLATE.w;
    jigH = FRAME_PLATE.h;
    cornerR = FRAME_PLATE.cornerR;
    plateDx = frameDx;
    plateDy = frameDy;
  } else if (settings.footprint === "tight" && placed.length) {
    // Crop only the printed plate. `placed` stays in bed mm so the template matches Full bed.
    // A finger notch sticks out of the part cell, so the crop follows it.
    const cells = footprintOf(placed);
    const loops = bboxOf(placed.flatMap((p) => p.loops));
    const notchGrew =
      loops.minX < cells.minX - 0.5 ||
      loops.minY < cells.minY - 0.5 ||
      loops.maxX > cells.maxX + 0.5 ||
      loops.maxY > cells.maxY + 0.5;
    const b = notchGrew
      ? { minX: Math.min(cells.minX, loops.minX), minY: Math.min(cells.minY, loops.minY), maxX: Math.max(cells.maxX, loops.maxX), maxY: Math.max(cells.maxY, loops.maxY), w: 0, h: 0 }
      : cells;
    if (notchGrew) {
      b.w = b.maxX - b.minX;
      b.h = b.maxY - b.minY;
    }
    const hostW = frameOn ? FRAME_PLATE.w : bed.w;
    const hostH = frameOn ? FRAME_PLATE.h : bed.h;
    const hostOx = frameOn ? frameDx : 0;
    const hostOy = frameOn ? frameDy : 0;
    const x = clampSpan(b.minX - settings.marginX + hostOx, b.w + 2 * settings.marginX, hostW);
    const y = clampSpan(b.minY - settings.marginY + hostOy, b.h + 2 * settings.marginY, hostH);
    jigW = x.size;
    jigH = y.size;
    plateDx = hostOx - x.origin;
    plateDy = hostOy - y.origin;
    const fullFrame = frameOn && Math.abs(jigW - FRAME_PLATE.w) < 1e-6 && Math.abs(jigH - FRAME_PLATE.h) < 1e-6;
    cornerR = fullFrame ? FRAME_PLATE.cornerR : 0;
  }

  const plateLoops = (p: PlacedPiece): Loop[] => p.loops.map((l) => translateLoop(l, plateDx, plateDy));
  const plateHoles = (p: PlacedPiece): Loop[] => p.holes.map((l) => translateLoop(l, plateDx, plateDy));

  const outer = cornerR > 0 ? roundedRectLoop(0, 0, jigW, jigH, cornerR) : rectLoop(jigW, jigH);

  const baseEntities: Entity[] = [outlineEntity(outer)];
  const pocketEntities: Entity[] = [outlineEntity(outer)];
  addReg(baseEntities);
  addReg(pocketEntities);

  const pickNotes: string[] = [];
  const pickByLabel = new Map<string, { cx: number; cy: number; r: number }>();
  for (const p of placed) {
    for (const loop of plateLoops(p)) {
      pocketEntities.push({ layer: "CUT", points: loop, closed: true, strokeWidth: 0.2 });
    }
    if (!settings.pickOut) continue;
    const cx = p.cx + plateDx;
    const cy = p.cy + plateDy;
    const r = settings.pickDia / 2;
    const holes = p.hmode === "jig" || p.hmode === "all" ? plateHoles(p) : [];
    if (!pickFits(plateLoops(p), holes, cx, cy, r, PICK_OUT_SIDE_MM)) {
      pickNotes.push(p.label);
      continue;
    }
    pickByLabel.set(p.label, { cx, cy, r });
    baseEntities.push({
      type: "circle",
      layer: "CUT",
      cx,
      cy,
      r,
    });
  }

  for (const p of placed) {
    p.paintSafe = paintSafeLoops(templateOuterLoops(p), settings);
  }

  const templateEntities: Entity[] = [
    { layer: "BED", points: rectLoop(bed.w, bed.h), closed: true, strokeWidth: 0.4 },
  ];
  for (const p of placed) {
    for (const loop of templateOuterLoops(p)) {
      templateEntities.push({
        layer: "CUT",
        points: loop,
        closed: true,
        strokeWidth: 0.25,
        color: p.color,
      });
    }
    for (const loop of p.paintSafe) {
      templateEntities.push(paintSafeGuideEntity(loop));
    }
    if (p.hmode === "template" || p.hmode === "all") {
      for (const loop of p.artHoles.length ? p.artHoles : p.holes) {
        templateEntities.push({ layer: "CUT", points: loop, closed: true, strokeWidth: 0.2, color: p.color });
      }
    }
    if (settings.showNum) {
      templateEntities.push({
        type: "text",
        layer: "TEXT",
        x: p.cx,
        y: p.cy,
        text: p.label,
        size: 4.5,
        color: p.color,
      });
    }
    templateEntities.push({
      layer: "GUIDE",
      points: [
        [p.cx - 2, p.cy],
        [p.cx + 2, p.cy],
      ],
      strokeWidth: 0.15,
    });
    templateEntities.push({
      layer: "GUIDE",
      points: [
        [p.cx, p.cy - 2],
        [p.cx, p.cy + 2],
      ],
      strokeWidth: 0.15,
    });
  }
  templateEntities.push({
    layer: "REG",
    points: [
      [0, 0],
      [10, 0],
    ],
    strokeWidth: 0.5,
  });
  templateEntities.push({
    layer: "REG",
    points: [
      [0, 0],
      [0, 10],
    ],
    strokeWidth: 0.5,
  });
  templateEntities.push({ type: "text", layer: "REG", x: 12, y: 4, text: "0,0", size: 4 });

  const meshPockets = placed.map((p) => {
    const loops = plateLoops(p);
    const leadOn = objects[p.obj]?.leadIn !== false;
    const leadIns = loops.map((loop) => leadInDepth(loop, leadOn));
    return {
      loops,
      holes: p.hmode === "jig" || p.hmode === "all" ? plateHoles(p) : [],
      pick: pickByLabel.get(p.label) ?? null,
      leadIn: leadIns[0] ?? 0,
      leadIns,
    };
  });

  const meshXform = plateMeshXform(outer, settings.scaleComp);
  const mesh = extrudePlate(outer, meshPockets, settings.baseThk, pocketDepth, settings.scaleComp);
  const plateOffset = { x: plateDx, y: plateDy };
  const solidH = solidHeight(settings.baseThk, pocketDepth);

  const maxBed = settings.maxPrintBed || 250;
  const oversized = jigW > maxBed + 1e-6 || jigH > maxBed + 1e-6;
  const splitPlan =
    settings.splitPlate && oversized
      ? planPlateSplits(
          jigW,
          jigH,
          maxBed,
          placed.map((p) => ({ label: p.label, loops: plateLoops(p) })),
        )
      : null;
  const splits = splitPlan?.splits ?? [];

  const blockers = [
    ...layout.blockers,
    ...wallBlockers(
      placed.map((p) => ({
        label: p.label,
        clearance: objects[p.obj]?.clear ?? 0,
        leadIn: objects[p.obj]?.leadIn !== false,
        loops: plateLoops(p),
      })),
      jigW,
      jigH,
    ),
  ];
  if (splitPlan?.blocked) blockers.push(splitPlan.blocked);

  const notices: string[] = [];
  if (layout.fits && oversized && !splitPlan?.blocked) {
    notices.push(
      settings.splitPlate
        ? `Placa ${jigW.toFixed(0)}×${jigH.toFixed(0)} mm > ${maxBed} mm: split en ${splits.length || 2} piezas (o imprime en H2).`
        : `Placa ${jigW.toFixed(0)}×${jigH.toFixed(0)} mm > cama FDM ${maxBed} mm. Por defecto se asume H2 (250×250×250+). Activa split para dividir, o imprime en una H2.`,
    );
  }
  for (const label of pickNotes) {
    notices.push(
      `El agujero de extracción Ø${formatMm(settings.pickDia, 1)} mm no cabe en ${label} (hacen falta ${PICK_OUT_SIDE_MM} mm por lado). Se omite.`,
    );
  }
  const warn = notices.length ? notices.join("\n") : null;

  const result: JigResult = {
    placed,
    jig: { w: jigW, h: jigH, cornerR },
    template: { entities: templateEntities, bed },
    laser: { baseEntities, pocketEntities },
    mesh,
    objects: prepped.map((o, i) => ({
      name: o.name,
      requested: o.count,
      placed: placed.filter((p) => p.obj === i).length,
      color: o.color,
      letter: o.letter,
      w: o.w,
      h: o.h,
      partHeight: o.partHeight,
    })),
    totalUnits: placed.length,
    fits: layout.fits,
    blockers,
    notices,
    partHeight: prepped.length ? Math.max(...prepped.map((o) => o.partHeight)) : 0,
    bed,
    plateName: plateLabel(settings),
    frameOn,
    oversized,
    splitNeeded: oversized,
    splits,
    warn,
    plateOffset,
    jigBedOrigin: { x: -plateDx, y: -plateDy },
    meshXform,
    solidH,
    plateOuter: outer,
    meshPockets,
    baseThk: settings.baseThk,
    pocketDepth,
    notchWarn: notchWarnings.length ? notchWarnings.join(" ") : null,
  };

  const openEdges = splits.length
    ? buildSplitMeshes(result).reduce((sum, piece) => sum + meshSingleIncidenceEdges(piece.mesh), 0)
    : meshSingleIncidenceEdges(mesh);
  if (openEdges > 0) {
    result.blockers.push(
      splits.length
        ? `La malla dividida tiene ${openEdges} aristas abiertas. No se exporta. Mueve las piezas o desactiva la división.`
        : `La malla tiene ${openEdges} aristas abiertas. No se exporta. Sube el margen o revisa el chaflán.`,
    );
  }
  return result;
}

export function splitMeshX(
  tris: JigResult["mesh"],
  x0: number,
  x1: number,
): JigResult["mesh"] {
  const pad = 0.05;
  return tris.filter((t) => {
    const xs = [t[0], t[3], t[6]];
    const mid = (xs[0] + xs[1] + xs[2]) / 3;
    return mid >= x0 - pad && mid <= x1 + pad;
  });
}

export function clipEntitiesX(entities: Entity[], x0: number, x1: number, shift: boolean): Entity[] {
  const out: Entity[] = [];
  for (const e of entities) {
    if (e.type === "circle" && e.cx != null) {
      if (e.cx >= x0 && e.cx <= x1) {
        out.push(shift ? { ...e, cx: e.cx - x0 } : { ...e });
      }
      continue;
    }
    if (e.type === "text" && e.x != null) {
      if (e.x >= x0 && e.x <= x1) {
        out.push(shift ? { ...e, x: e.x - x0 } : { ...e });
      }
      continue;
    }
    if (e.points) {
      const pts = e.points.map(([x, y]) => [shift ? x - x0 : x, y] as [number, number]);
      const xs = e.points.map((p) => p[0]);
      const min = Math.min(...xs),
        max = Math.max(...xs);
      if (max < x0 || min > x1) continue;
      out.push({ ...e, points: pts });
    }
  }
  return out;
}

export function bedSizeLabel(bed: BedSize): string {
  return `${bed.name} ${bed.w}×${bed.h}`;
}
