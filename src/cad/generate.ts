import { FRAME_PLATE } from "../constants";
import type { BedSize, Entity, JobObject, JobSettings, JigResult, Loop, PlacedPiece } from "../types";
import { bboxOf, rectLoop, roundedRectLoop, translateLoop } from "./geom";
import { applyMoves, packObjects, shiftPiece } from "./layout";
import { extrudePlate } from "./mesh";
import { bedFromSettings, plateLabel } from "./filename";
import { prepareObject } from "./prepare";

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

export function generateJig(
  objects: JobObject[],
  stlMap: Record<string, ArrayBuffer | null>,
  settings: JobSettings,
  moves: Record<string, [number, number]> = {},
): JigResult {
  const bed = bedFromSettings(settings);
  const frameOn = settings.bed === "333x88" && settings.useAdapter;
  const prepped = objects.map((o, i) => prepareObject(o, stlMap[o.id] || null, i));
  const pack = packObjects(prepped, bed.w, bed.h, settings);
  applyMoves(pack.placed, moves, bed.w, bed.h);

  let jigW = bed.w;
  let jigH = bed.h;
  let cornerR = 0;
  let plateDx = 0;
  let plateDy = 0;
  const placed = pack.placed.map((p) => ({ ...p }));

  if (frameOn) {
    jigW = FRAME_PLATE.w;
    jigH = FRAME_PLATE.h;
    cornerR = FRAME_PLATE.cornerR;
    plateDx = (FRAME_PLATE.w - bed.w) / 2;
    plateDy = (FRAME_PLATE.h - bed.h) / 2;
    if (settings.footprint === "tight" && placed.length) {
      const b = bboxOf(placed.flatMap((p) => p.loops));
      jigW = Math.min(FRAME_PLATE.w, Math.max(30, b.w + 2 * settings.marginX));
      jigH = FRAME_PLATE.h;
      const bedRight = bed.w;
      const targetRight = bedRight - settings.marginX;
      const shiftX = targetRight - b.maxX;
      const shiftY = settings.marginY - b.minY;
      for (const p of placed) shiftPiece(p, shiftX, shiftY);
      plateDx = FRAME_PLATE.w - jigW;
      plateDy = 0;
    }
  } else if (settings.footprint === "tight" && placed.length) {
    const b = bboxOf(placed.flatMap((p) => p.loops));
    jigW = b.w + 2 * settings.marginX;
    jigH = b.h + 2 * settings.marginY;
    const dx = settings.marginX - b.minX;
    const dy = settings.marginY - b.minY;
    for (const p of placed) shiftPiece(p, dx, dy);
    plateDx = 0;
    plateDy = 0;
  }

  const plateLoops = (p: PlacedPiece): Loop[] => p.loops.map((l) => translateLoop(l, plateDx, plateDy));
  const plateHoles = (p: PlacedPiece): Loop[] => p.holes.map((l) => translateLoop(l, plateDx, plateDy));

  const outer = cornerR > 0 ? roundedRectLoop(0, 0, jigW, jigH, cornerR) : rectLoop(jigW, jigH);

  const baseEntities: Entity[] = [outlineEntity(outer)];
  const pocketEntities: Entity[] = [outlineEntity(outer)];
  addReg(baseEntities);
  addReg(pocketEntities);

  for (const p of placed) {
    for (const loop of plateLoops(p)) {
      pocketEntities.push({ layer: "CUT", points: loop, closed: true, strokeWidth: 0.2 });
    }
    if (p.hmode === "jig" || p.hmode === "all") {
      for (const loop of plateHoles(p)) {
        pocketEntities.push({ layer: "CUT", points: loop, closed: true, strokeWidth: 0.2 });
      }
    }
    if (settings.pickOut) {
      pocketEntities.push({
        type: "circle",
        layer: "CUT",
        cx: p.cx + plateDx,
        cy: p.cy + plateDy,
        r: settings.pickDia / 2,
      });
    }
  }

  const templateEntities: Entity[] = [
    { layer: "BED", points: rectLoop(bed.w, bed.h), closed: true, strokeWidth: 0.4 },
  ];
  for (const p of placed) {
    for (const loop of p.art.length ? p.art : p.loops) {
      templateEntities.push({
        layer: "CUT",
        points: loop,
        closed: true,
        strokeWidth: 0.25,
        color: p.color,
      });
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

  const meshPockets = placed.map((p) => ({
    loops: plateLoops(p),
    holes: p.hmode === "jig" || p.hmode === "all" ? plateHoles(p) : [],
    pick: settings.pickOut
      ? { cx: p.cx + plateDx, cy: p.cy + plateDy, r: settings.pickDia / 2 }
      : null,
  }));

  const mesh = extrudePlate(outer, meshPockets, settings.baseThk, settings.pocketDepth, settings.scaleComp);

  const maxBed = settings.maxPrintBed || 250;
  const oversized = jigW > maxBed + 1e-6 || jigH > maxBed + 1e-6;
  const splits: JigResult["splits"] = [];
  if (settings.splitPlate && oversized) {
    const long = jigW >= jigH ? jigW : jigH;
    const n = Math.max(2, Math.ceil(long / maxBed));
    const piece = long / n;
    for (let i = 0; i < n; i++) {
      splits.push({ x0: i * piece, x1: Math.min(long, (i + 1) * piece), label: `s${i + 1}` });
    }
  }

  let warn: string | null = null;
  if (!pack.fits) {
    warn = "No cabe todo en la cama. Baja qty, spacing o márgenes, o usa Tight / cama Large.";
  } else if (oversized) {
    warn = settings.splitPlate
      ? `Placa ${jigW.toFixed(0)}×${jigH.toFixed(0)} mm > ${maxBed} mm: split en ${splits.length || 2} piezas (o imprime en H2).`
      : `Placa ${jigW.toFixed(0)}×${jigH.toFixed(0)} mm > cama FDM ${maxBed} mm. Por defecto se asume H2 (250×250×250+). Activa split para dividir, o imprime en una H2.`;
  }

  return {
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
    fits: pack.fits,
    partHeight: prepped.length ? Math.max(...prepped.map((o) => o.partHeight)) : 0,
    bed,
    plateName: plateLabel(settings),
    frameOn,
    oversized,
    splitNeeded: oversized,
    splits,
    warn,
  };
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
