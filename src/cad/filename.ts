import { LARGE_BED, MINI_BED } from "../constants";
import type { BedSize, JobSettings } from "../types";
import { sanitizeName } from "./geom";

export function bedFromSettings(s: JobSettings): BedSize {
  if (s.bed === "custom") {
    return { w: s.bedW, h: s.bedH, name: "Custom", id: "custom" };
  }
  if (s.bed === "333x418") return { ...LARGE_BED };
  return { ...MINI_BED };
}

export function plateLabel(s: JobSettings): string {
  if (s.bed === "333x88" && s.useAdapter) return "MiniFrame";
  return bedFromSettings(s).name;
}

export function exportBasename(name: string, bed: string, nUp: number): string {
  return `${sanitizeName(name)}_${bed}_${nUp}up`;
}
