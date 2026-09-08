import type { JigResult, Loop, PlacedPiece } from "../types";

export type MeshXform = { cx: number; cy: number; s: number };
export type PlateOffset = { x: number; y: number };

/** Pocket, visible art, and holes from one placed piece — already in the same pose. */
export function piecePose(piece: PlacedPiece): { pocket: Loop[]; art: Loop[]; holes: Loop[] } {
  return {
    pocket: piece.loops,
    art: piece.art.length ? piece.art : piece.loops,
    holes: piece.artHoles.length ? piece.artHoles : piece.holes,
  };
}

export function plateOffsetOf(result: JigResult): PlateOffset {
  return result.plateOffset;
}

export function toPlateXy(x: number, y: number, offset: PlateOffset): [number, number] {
  return [x + offset.x, y + offset.y];
}

/** Same XY/Z scale as `extrudePlate` (scaleComp around the plate centroid). */
export function toMeshPoint(
  x: number,
  y: number,
  z: number,
  offset: PlateOffset,
  xform: MeshXform,
): [number, number, number] {
  const px = x + offset.x;
  const py = y + offset.y;
  return [xform.cx + (px - xform.cx) * xform.s, xform.cy + (py - xform.cy) * xform.s, z * xform.s];
}

export function poseLoopsOnPlate(piece: PlacedPiece, offset: PlateOffset): { pocket: Loop[]; art: Loop[]; holes: Loop[] } {
  const pose = piecePose(piece);
  const shift = (loops: Loop[]) => loops.map((l) => l.map(([x, y]) => toPlateXy(x, y, offset)));
  return { pocket: shift(pose.pocket), art: shift(pose.art), holes: shift(pose.holes) };
}
