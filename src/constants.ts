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
  /** Per-side inset so an 18 mm pocket yields a ~13 mm paint face. */
  paintSafeInset: 2.5,
  paintSafeW: 13,
  paintSafeH: 13,
} as const;

/** Template/Contours paint-safe GUIDE stroke — CSS `--ok`, not CUT red. */
export const PAINT_SAFE_COLOR = "#22C55E";
export const PAINT_SAFE_DASH = [1.6, 1] as const;

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
  "paintSafe",
  "zDownFlip",
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

/**
 * 45° pocket-mouth chamfer (mm), only when Z-down flip puts the mouth on the bed.
 * The opening grows by this much per side over the same vertical distance.
 * Do not also offset for elephant foot — slicers already apply ~0.15 mm, and
 * stacking both makes an 18×18 pocket oversize.
 */
export const POCKET_MOUTH_CHAMFER = 0.4;
/** Used when the wall between pockets is thinner than POCKET_MOUTH_THIN_WALL. */
export const POCKET_MOUTH_CHAMFER_THIN = 0.3;
/** Inter-pocket wall (mm) below which the thin-wall chamfer is used. */
export const POCKET_MOUTH_THIN_WALL = 1.2;

/** Engraved origin L (mm) on the face that ends up on top after a Z-down flip. */
export const ORIGIN_MARK_LEG = 16;
export const ORIGIN_MARK_WIDTH = 4;
export const ORIGIN_MARK_DEPTH = 2;

/** PLA split joints (Hand Solo): dowels on the cut face, not through pockets. */
export const SPLIT_OVERLAP = 2.5;
export const SPLIT_DOWEL_DIA = 3.0;
/** Hand Solo: female hole must be 3.2–3.3 mm (not a loose ~3.5). */
export const SPLIT_HOLE_DIA_MIN = 3.2;
export const SPLIT_HOLE_DIA_MAX = 3.3;
/** 0.25 mm clearance on the Ø3.0 pin — inside the 3.2–3.3 window. */
export const SPLIT_HOLE_DIA = 3.25;
export const SPLIT_TAB_INSET = 14;
