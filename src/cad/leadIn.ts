import { LEAD_IN_MM, LEAD_IN_NARROW_BELOW, LEAD_IN_NARROW_MM } from "../constants";
import type { Loop } from "../types";
import { bboxOf } from "./geom";

/** 0.6 mm, or 0.3 mm when the pocket's narrower side is under 4 mm. */
export function leadInDepth(loop: Loop, enabled: boolean): number {
  if (!enabled) return 0;
  const box = bboxOf([loop]);
  const narrow = Math.min(box.w, box.h);
  return narrow < LEAD_IN_NARROW_BELOW ? LEAD_IN_NARROW_MM : LEAD_IN_MM;
}
