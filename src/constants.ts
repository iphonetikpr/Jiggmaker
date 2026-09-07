/** Locked CAD constants for eufyMake E1 jigs. */

export const SCALE_COMP = 1.003;

export const FRAME_CLEARANCE = 0.3;

export const POCKET_DEPTH_EXTRA = 0.2;

export const MINI_BED = { w: 333, h: 88, id: "333x88", name: "Mini" } as const;
export const LARGE_BED = { w: 333, h: 418, id: "333x418", name: "Large" } as const;

/** Frame ON (Mini only). Export plate stays 334×90 — do not shrink by FRAME_CLEARANCE. */
export const FRAME_PLATE = { w: 334, h: 90, cornerR: 8 } as const;

export const DEFAULTS = {
  pocketDepth: 4,
  baseThk: 3,
  matThk: 3,
  dpi: 300,
  clearance: 0.15,
  spacingX: 5,
  spacingY: 5,
  marginX: 2,
  marginY: 2,
  objGap: 10,
  offsetPct: 50,
  pickDia: 8,
  maxPrintBed: 250,
  rectW: 50,
  rectH: 30,
  qty: 1,
} as const;

export const HISTORY_KEY = "eufyJig.history.v1";
export const HISTORY_FILENAME = "eufyMake_jig_history.json";

export const HISTORY_SETTING_FIELDS = [
  "bed",
  "bedW",
  "bedH",
  "spacingX",
  "spacingY",
  "marginX",
  "marginY",
  "objGap",
  "footprint",
  "offsetPct",
  "matThk",
  "pickDia",
  "baseThk",
  "pocketDepth",
  "dpi",
] as const;

export const HISTORY_CHECK_FIELDS = [
  "center",
  "nest",
  "pickOut",
  "showNum",
  "useAdapter",
] as const;

/** Extra keys stored alongside source-compatible settings. */
export const HISTORY_EXTRA_FIELDS = [
  "scaleComp",
  "maxPrintBed",
  "splitPlate",
] as const;

export const OBJECT_COLORS = ["#3DDC97", "#5B8DEF", "#F5A623"] as const;

export const LAYER_SVG: Record<string, string> = {
  CUT: "#E74C3C",
  POCKET: "#E74C3C",
  OUTLINE: "#E74C3C",
  SCORE: "#3B82F6",
  GUIDE: "#3B82F6",
  REG: "#3B82F6",
  BED: "#6B7280",
  TEXT: "#222222",
};

export const LAYER_ACI: Record<string, number> = {
  CUT: 1,
  POCKET: 1,
  OUTLINE: 1,
  SCORE: 5,
  GUIDE: 5,
  REG: 5,
  BED: 8,
  TEXT: 250,
};

export const MAX_OBJECTS = 3;
export const PRINT_TARGET = 250;
