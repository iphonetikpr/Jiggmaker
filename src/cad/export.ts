import type { Entity, JigResult } from "../types";
import { toDXF } from "./dxf";
import { exportBasename } from "./filename";
import { clipEntitiesX, splitMeshX } from "./generate";
import { toAsciiSTL, toBinarySTL } from "./mesh";
import { toSVG } from "./svg";

export interface ExportFile {
  name: string;
  mime: string;
  data: string | ArrayBuffer | Blob;
}

function downloadBlob(name: string, blob: Blob) {
  const a = document.createElement("a");
  const url = URL.createObjectURL(blob);
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

export function downloadBytes(name: string, data: string | ArrayBuffer | Blob, mime: string) {
  const blob = data instanceof Blob ? data : new Blob([data], { type: mime });
  downloadBlob(name, blob);
}

export function baseName(result: JigResult, objectName: string): string {
  const name =
    result.objects.length === 1 ? result.objects[0].name || objectName : objectName || "multi";
  return exportBasename(name, result.plateName, result.totalUnits);
}

function splitOrAll<T>(
  result: JigResult,
  build: (x0: number, x1: number, tag: string) => T,
): T[] {
  if (!result.splits.length) return [build(0, result.jig.w, "")];
  return result.splits.map((s) => build(s.x0, s.x1, `_${s.label}`));
}

export function laserFiles(result: JigResult, stem: string): ExportFile[] {
  const files: ExportFile[] = [];
  const w = result.jig.w;
  const h = result.jig.h;
  const pushSvgDxf = (kind: "POCKET" | "BASE", entities: Entity[]) => {
    for (const piece of splitOrAll(result, (x0, x1, tag) => ({ x0, x1, tag }))) {
      const ents =
        piece.tag && result.splits.length
          ? clipEntitiesX(entities, piece.x0, piece.x1, true)
          : entities;
      const pw = piece.tag ? piece.x1 - piece.x0 : w;
      files.push({
        name: `${stem}${piece.tag}_${kind}.dxf`,
        mime: "application/dxf",
        data: toDXF(ents),
      });
      files.push({
        name: `${stem}${piece.tag}_${kind}.svg`,
        mime: "image/svg+xml",
        data: toSVG(pw, h, ents),
      });
    }
  };
  pushSvgDxf("POCKET", result.laser.pocketEntities);
  pushSvgDxf("BASE", result.laser.baseEntities);
  return files;
}

export function stlFiles(result: JigResult, stem: string): ExportFile[] {
  const files: ExportFile[] = [];
  if (!result.splits.length) {
    files.push({ name: `${stem}.stl`, mime: "model/stl", data: toBinarySTL(result.mesh) });
    files.push({
      name: `${stem}_ascii.stl`,
      mime: "model/stl",
      data: toAsciiSTL(result.mesh, stem),
    });
    return files;
  }
  for (const s of result.splits) {
    const mesh = splitMeshX(result.mesh, s.x0, s.x1);
    const tag = `${stem}_${s.label}`;
    files.push({ name: `${tag}.stl`, mime: "model/stl", data: toBinarySTL(mesh) });
    files.push({
      name: `${tag}_ascii.stl`,
      mime: "model/stl",
      data: toAsciiSTL(mesh, tag),
    });
  }
  return files;
}

export function templateSvg(result: JigResult, stem: string): ExportFile {
  return {
    name: `${stem}_TEMPLATE.svg`,
    mime: "image/svg+xml",
    data: toSVG(result.template.bed.w, result.template.bed.h, result.template.entities, {
      background: "#ffffff",
    }),
  };
}

export function contoursSvg(result: JigResult, stem: string): ExportFile {
  const ents: Entity[] = [];
  for (const p of result.placed) {
    const rings = p.art.length ? p.art : p.loops;
    ents.push({
      layer: "CUT",
      rings,
      fill: "#000000",
      color: "#000000",
      strokeWidth: 0.05,
    });
  }
  return {
    name: `${stem}_CONTOURS.svg`,
    mime: "image/svg+xml",
    data: toSVG(result.template.bed.w, result.template.bed.h, ents, { background: "#ffffff" }),
  };
}

export function templatePngName(stem: string, dpi: number): string {
  return `${stem}_TEMPLATE_${dpi}dpi.png`;
}
