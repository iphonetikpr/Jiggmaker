import type { Entity, JigResult } from "../types";
import { toDXF } from "./dxf";
import { exportBasename } from "./filename";
import { toAsciiSTL, toBinarySTL } from "./mesh";
import { buildSplitMeshes } from "./split";
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

export function laserFiles(result: JigResult, stem: string): ExportFile[] {
  const files: ExportFile[] = [];
  const w = result.jig.w;
  const h = result.jig.h;
  const pushSvgDxf = (kind: "POCKET" | "BASE", entities: typeof result.laser.pocketEntities) => {
    files.push({
      name: `${stem}_${kind}.dxf`,
      mime: "application/dxf",
      data: toDXF(entities),
    });
    files.push({
      name: `${stem}_${kind}.svg`,
      mime: "image/svg+xml",
      data: toSVG(w, h, entities),
    });
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
  for (const piece of buildSplitMeshes(result)) {
    const tag = `${stem}_${piece.split.label}`;
    files.push({ name: `${tag}.stl`, mime: "model/stl", data: toBinarySTL(piece.mesh) });
    files.push({
      name: `${tag}_ascii.stl`,
      mime: "model/stl",
      data: toAsciiSTL(piece.mesh, tag),
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
