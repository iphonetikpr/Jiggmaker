import { MAX_OBJECTS, PROJECT_SCHEMA, PROJECT_SCHEMA_VERSION } from "../constants";
import type { HistoryJob, JobObject, JobSettings } from "../types";
import { applyHistorySettings, b64ToBytes, newObject, serializeJob } from "./history";
import { parseSTL } from "./stl";

export interface ProjectDocument {
  schema: typeof PROJECT_SCHEMA;
  schemaVersion: number;
  name: string;
  savedAt: string;
  settings: HistoryJob["settings"];
  objects: HistoryJob["objects"];
  moves?: Record<string, [number, number]>;
}

export type ProjectResult<T> = { ok: true; value: T } | { ok: false; error: string };

export function projectFilename(name: string): string {
  const safe = name.trim().replace(/[^\w\-]+/g, "_").replace(/^_+|_+$/g, "") || "proyecto";
  return `${safe}.jiggmaker.json`;
}

export function serializeProject(
  name: string,
  settings: JobSettings,
  objects: JobObject[],
  stlMap: Record<string, ArrayBuffer | null>,
  moves: Record<string, [number, number]>,
): ProjectDocument {
  const job = serializeJob(name, settings, objects, stlMap, moves);
  return {
    schema: PROJECT_SCHEMA,
    schemaVersion: PROJECT_SCHEMA_VERSION,
    name: job.name,
    savedAt: job.date,
    settings: job.settings,
    objects: job.objects,
    moves: job.moves,
  };
}

export function parseProject(raw: unknown): ProjectResult<ProjectDocument> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error: "No es un archivo de proyecto Jiggmaker." };
  }
  const rec = raw as Record<string, unknown>;
  if (rec.schema !== PROJECT_SCHEMA) {
    return { ok: false, error: "No es un archivo de proyecto Jiggmaker." };
  }
  if (rec.schemaVersion == null) {
    return { ok: false, error: "Falta schemaVersion." };
  }
  if (rec.schemaVersion !== PROJECT_SCHEMA_VERSION) {
    return {
      ok: false,
      error: `schemaVersion ${String(rec.schemaVersion)} no está soportada (se espera ${PROJECT_SCHEMA_VERSION}).`,
    };
  }
  if (!rec.settings || typeof rec.settings !== "object" || Array.isArray(rec.settings)) {
    return { ok: false, error: "Faltan los parámetros (settings)." };
  }
  if (!Array.isArray(rec.objects)) {
    return { ok: false, error: "Faltan los objetos del proyecto." };
  }
  if (rec.objects.length === 0) {
    return { ok: false, error: "El proyecto no incluye objetos." };
  }
  if (rec.objects.length > MAX_OBJECTS) {
    return { ok: false, error: `Máximo ${MAX_OBJECTS} objetos.` };
  }
  for (const obj of rec.objects) {
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) {
      return { ok: false, error: "Un objeto del proyecto no es válido." };
    }
    const stl = (obj as { stl?: unknown }).stl;
    if (stl != null && typeof stl !== "string") {
      return { ok: false, error: "El STL embebido no es texto base64." };
    }
  }
  const moves = parseMoves(rec.moves);
  if (!moves.ok) return moves;
  const name = typeof rec.name === "string" && rec.name.trim() ? rec.name.trim() : "proyecto";
  const savedAt = typeof rec.savedAt === "string" ? rec.savedAt : new Date().toISOString();
  return {
    ok: true,
    value: {
      schema: PROJECT_SCHEMA,
      schemaVersion: PROJECT_SCHEMA_VERSION,
      name,
      savedAt,
      settings: rec.settings as HistoryJob["settings"],
      objects: rec.objects as HistoryJob["objects"],
      moves: Object.keys(moves.value).length ? moves.value : undefined,
    },
  };
}

export interface MaterializedProject {
  settings: JobSettings;
  objects: JobObject[];
  stlMap: Record<string, ArrayBuffer | null>;
  moves: Record<string, [number, number]>;
  name: string;
}

export function materializeProject(project: ProjectDocument): ProjectResult<MaterializedProject> {
  const settings = applyHistorySettings(project.settings || {});
  const objects: JobObject[] = [];
  const stlMap: Record<string, ArrayBuffer | null> = {};
  for (let i = 0; i < project.objects.length; i++) {
    const raw = project.objects[i];
    const o = newObject(i);
    o.name = raw.name || "";
    o.count = raw.count || 1;
    o.up = isUp(raw.up) ? raw.up : "z+";
    o.rot = raw.rot || 0;
    o.mirror = !!raw.mirror;
    o.auto = !!raw.auto;
    o.mode = raw.mode === "rectangle" ? "rectangle" : "silhouette";
    o.clear = typeof raw.clear === "number" ? raw.clear : o.clear;
    o.notch = raw.notch === true;
    o.leadIn = raw.leadIn == null ? true : raw.leadIn === true;
    o.holes = isHoles(raw.holes) ? raw.holes : "none";
    o.stlName = raw.stlName || null;
    o.rectW = raw.rectW ?? o.rectW;
    o.rectH = raw.rectH ?? o.rectH;
    if (raw.stl) {
      try {
        const buf = b64ToBytes(raw.stl);
        parseSTL(buf);
        stlMap[o.id] = buf;
        o.stl = raw.stl;
      } catch {
        return { ok: false, error: `STL de «${o.name || o.stlName || "objeto"}» no se puede leer.` };
      }
    } else {
      o.mode = "rectangle";
    }
    objects.push(o);
  }
  return {
    ok: true,
    value: {
      settings,
      objects,
      stlMap,
      moves: project.moves ? { ...project.moves } : {},
      name: project.name,
    },
  };
}

function parseMoves(raw: unknown): ProjectResult<Record<string, [number, number]>> {
  if (raw == null) return { ok: true, value: {} };
  if (typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error: "moves no es un objeto." };
  }
  const moves: Record<string, [number, number]> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!Array.isArray(value) || value.length !== 2 || !value.every((n) => typeof n === "number" && Number.isFinite(n))) {
      return { ok: false, error: `Movimiento «${key}» no es válido.` };
    }
    moves[key] = [value[0], value[1]];
  }
  return { ok: true, value: moves };
}

function isUp(value: string): value is JobObject["up"] {
  return value === "z+" || value === "z-" || value === "y+" || value === "y-" || value === "x+" || value === "x-";
}

function isHoles(value: string): value is JobObject["holes"] {
  return value === "none" || value === "template" || value === "jig" || value === "all";
}
