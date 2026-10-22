import { describe, expect, it } from "vitest";
import { PROJECT_SCHEMA, PROJECT_SCHEMA_VERSION } from "../constants";
import { generateJig } from "./generate";
import { bboxOf } from "./geom";
import { defaultSettings, newObject } from "./history";
import { materializeProject, parseProject, projectFilename, serializeProject } from "./projectFile";
import { makeBoxStl } from "./stl";
import type { JobObject, JobSettings, Loop } from "../types";

function sig(loops: Loop[]): string {
  return loops.map((l) => l.map((p) => `${p[0].toFixed(2)},${p[1].toFixed(2)}`).join(" ")).join("|");
}

describe("project file", () => {
  it("round-trips settings, STL, up axis, rotation, and positions", () => {
    const settings: JobSettings = {
      ...defaultSettings(),
      bed: "333x418",
      footprint: "tight",
      baseThk: 2,
      pocketDepth: 24,
      marginX: 4,
      marginY: 3,
      spacingX: 8,
      useAdapter: false,
      center: true,
    };
    const obj = newObject(0);
    obj.name = "caja";
    obj.stlName = "caja";
    obj.mode = "silhouette";
    obj.up = "z-";
    obj.rot = 90;
    obj.clear = 0.35;
    obj.count = 1;
    const buf = makeBoxStl(30, 16, 8);
    const moves = { A1: [6, -4] as [number, number] };
    const doc = serializeProject("caja", settings, [obj], { [obj.id]: buf }, moves);
    expect(doc.schema).toBe(PROJECT_SCHEMA);
    expect(doc.schemaVersion).toBe(PROJECT_SCHEMA_VERSION);
    expect(projectFilename(doc.name)).toBe("caja.jiggmaker.json");

    const parsed = parseProject(JSON.parse(JSON.stringify(doc)));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const job = materializeProject(parsed.value);
    expect(job.ok).toBe(true);
    if (!job.ok) return;

    expect(job.value.settings.pocketDepth).toBe(24);
    expect(job.value.settings.baseThk).toBe(2);
    expect(job.value.settings.footprint).toBe("tight");
    expect(job.value.settings.marginX).toBe(4);
    expect(job.value.objects[0].up).toBe("z-");
    expect(job.value.objects[0].rot).toBe(90);
    expect(job.value.objects[0].clear).toBe(0.35);
    expect(job.value.moves.A1).toEqual([6, -4]);
    expect(job.value.stlMap[job.value.objects[0].id]?.byteLength).toBe(buf.byteLength);

    const before = generateJig([obj], { [obj.id]: buf }, settings, moves);
    const after = generateJig(job.value.objects, job.value.stlMap, job.value.settings, job.value.moves);
    expect(after.solidH).toBeCloseTo(before.solidH, 5);
    expect(after.solidH).toBeCloseTo(26, 5);
    expect(after.jig.w).toBeCloseTo(before.jig.w, 5);
    expect(after.jig.h).toBeCloseTo(before.jig.h, 5);
    expect(after.placed[0].cx).toBeCloseTo(before.placed[0].cx, 5);
    expect(after.placed[0].cy).toBeCloseTo(before.placed[0].cy, 5);
    expect(sig(after.placed[0].loops)).toBe(sig(before.placed[0].loops));
    expect(after.partHeight).toBeCloseTo(before.partHeight, 5);
    expect(bboxOf(after.placed[0].loops).w).toBeGreaterThan(10);

    const unmoved = generateJig(job.value.objects, job.value.stlMap, job.value.settings, {});
    expect(after.placed[0].cx).not.toBeCloseTo(unmoved.placed[0].cx, 1);
  });

  it("rejects files that are not a supported project", () => {
    expect(parseProject(null).ok).toBe(false);
    expect(parseProject([{ settings: {} }]).ok).toBe(false);
    const missing = parseProject({ schema: PROJECT_SCHEMA, settings: {}, objects: [{}] });
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.error).toMatch(/schemaVersion/);

    const future = parseProject({
      schema: PROJECT_SCHEMA,
      schemaVersion: 2,
      settings: {},
      objects: [{ name: "a" }],
    });
    expect(future.ok).toBe(false);
    if (!future.ok) expect(future.error).toMatch(/no está soportada/);

    const badMove = parseProject({
      schema: PROJECT_SCHEMA,
      schemaVersion: 1,
      settings: { pocketDepth: 3 },
      objects: [{ name: "a", rectW: 10, rectH: 10 }],
      moves: { A1: [1] },
    });
    expect(badMove.ok).toBe(false);
    if (!badMove.ok) expect(badMove.error).toMatch(/Movimiento/);

    const empty = parseProject({ schema: PROJECT_SCHEMA, schemaVersion: 1, settings: {}, objects: [] });
    expect(empty.ok).toBe(false);
    if (!empty.ok) expect(empty.error).toMatch(/no incluye objetos/);
  });

  it("reports an unreadable embedded STL", () => {
    const obj: JobObject = { ...newObject(0), name: "roto", stlName: "roto", mode: "silhouette" };
    const doc = serializeProject("roto", defaultSettings(), [obj], {}, {});
    doc.objects[0].stl = "@@@not-base64@@@";
    const parsed = parseProject(doc);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const job = materializeProject(parsed.value);
    expect(job.ok).toBe(false);
    if (!job.ok) expect(job.error).toMatch(/STL/);
  });
});
