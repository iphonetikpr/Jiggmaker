export type BedId = "333x88" | "333x418" | "custom";
export type Footprint = "bed" | "tight";
export type PocketMode = "silhouette" | "rectangle";
export type UpAxis = "z+" | "z-" | "y+" | "y-" | "x+" | "x-";
export type HolesMode = "none" | "template" | "jig" | "all";
export type StepId = "setup" | "layout" | "output";
export type PreviewMode = "template" | "jig3d" | "laserPocket" | "laserBase";

export type Pt = [number, number];
export type Loop = Pt[];
export type Tri = [number, number, number, number, number, number, number, number, number];

export interface StlMesh {
  positions: Float32Array;
  count: number;
}

export interface JobSettings {
  bed: BedId;
  bedW: number;
  bedH: number;
  spacingX: number;
  spacingY: number;
  marginX: number;
  marginY: number;
  objGap: number;
  footprint: Footprint;
  offsetPct: number;
  matThk: number;
  pickDia: number;
  baseThk: number;
  pocketDepth: number;
  dpi: number;
  center: boolean;
  nest: boolean;
  pickOut: boolean;
  showNum: boolean;
  useAdapter: boolean;
  scaleComp: boolean;
  maxPrintBed: number;
  splitPlate: boolean;
}

export interface JobObject {
  id: string;
  name: string;
  count: number;
  up: UpAxis;
  rot: number;
  mirror: boolean;
  auto: boolean;
  mode: PocketMode;
  clear: number;
  holes: HolesMode;
  stlName: string | null;
  stl: string | null;
  rectW: number;
  rectH: number;
}

export interface HistoryJob {
  id: string;
  name: string;
  date: string;
  settings: Partial<JobSettings> & Record<string, string | number | boolean>;
  objects: Array<{
    name: string;
    count: number;
    up: string;
    rot: number;
    mirror: boolean;
    auto: boolean;
    mode: string;
    clear: number;
    holes: string;
    stlName: string;
    stl?: string;
    rectW?: number;
    rectH?: number;
  }>;
  moves?: Record<string, [number, number]>;
}

export interface Entity {
  layer: string;
  points?: Loop;
  closed?: boolean;
  type?: "circle" | "text" | "path";
  cx?: number;
  cy?: number;
  r?: number;
  x?: number;
  y?: number;
  text?: string;
  size?: number;
  color?: string;
  fill?: string;
  strokeWidth?: number;
  rings?: Loop[];
}

export interface PreparedObject {
  id: string;
  name: string;
  count: number;
  letter: string;
  color: string;
  loops: Loop[];
  holes: Loop[];
  artLoops: Loop[];
  artHoles: Loop[];
  holesMode: HolesMode;
  w: number;
  h: number;
  partHeight: number;
}

export interface PlacedPiece {
  obj: number;
  label: string;
  color: string;
  x: number;
  y: number;
  cx: number;
  cy: number;
  w: number;
  h: number;
  loops: Loop[];
  holes: Loop[];
  art: Loop[];
  artHoles: Loop[];
  hmode: HolesMode;
}

export interface BedSize {
  w: number;
  h: number;
  name: string;
  id: string;
}

export interface JigResult {
  placed: PlacedPiece[];
  jig: { w: number; h: number; cornerR: number };
  template: { entities: Entity[]; bed: BedSize };
  laser: { baseEntities: Entity[]; pocketEntities: Entity[] };
  mesh: Tri[];
  objects: Array<{
    name: string;
    requested: number;
    placed: number;
    color: string;
    letter: string;
    w: number;
    h: number;
    partHeight: number;
  }>;
  totalUnits: number;
  fits: boolean;
  partHeight: number;
  bed: BedSize;
  plateName: string;
  frameOn: boolean;
  oversized: boolean;
  splitNeeded: boolean;
  splits: Array<{ x0: number; x1: number; label: string }>;
  warn: string | null;
  /** Bed mm → plate mm (frame / tight). Same delta used for mesh pockets and laser CUT. */
  plateOffset: { x: number; y: number };
  /** Uniform plate scale around the plate centroid (`scaleComp`). */
  meshXform: { cx: number; cy: number; s: number };
  /** Unscaled solid height (base + pocket, or through-hole thickness). */
  solidH: number;
}
