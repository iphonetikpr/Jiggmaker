import type { PreviewMode } from "../types";

/** Footer copy under the preview canvas. 3D jig orbits; 2D tabs pan. */
export function previewHint(mode: PreviewMode): string {
  if (mode === "jig3d") {
    return "Drag to orbit / rotate the jig · scroll to zoom. Click a cube face to snap the view.";
  }
  if (mode === "template") {
    return "Scroll to zoom, drag empty space to pan. Drag a piece silhouette to reposition it.";
  }
  return "Scroll to zoom, drag empty space to pan.";
}

/** The 3D-tab copy from the before screenshot — must never appear on jig3d. */
export const BEFORE_3D_PAN_FOOTER =
  "Scroll to zoom, drag empty space to pan. In Template view, drag a piece to reposition it.";
