import { describe, expect, it } from "vitest";
import { DEFAULTS, PRESET_KEY } from "../constants";
import { memoryStore } from "../storage/store";
import { defaultSettings, newObject } from "./history";
import {
  BUILTIN_DEFAULTS_ID,
  applyObjectParams,
  capturePreset,
  defaultsPreset,
  listPresets,
  loadUserPresets,
  presetDiffers,
  saveUserPresets,
} from "./presets";

describe("presets", () => {
  it("ships a read-only Defaults preset at 2 mm base and 3 mm pocket", () => {
    const defaults = defaultsPreset();
    expect(defaults.id).toBe(BUILTIN_DEFAULTS_ID);
    expect(defaults.readonly).toBe(true);
    expect(defaults.settings.baseThk).toBe(2);
    expect(defaults.settings.pocketDepth).toBe(3);
    expect(defaults.settings.baseThk).toBe(DEFAULTS.baseThk);
    expect(defaults.settings.pocketDepth).toBe(DEFAULTS.pocketDepth);
    expect(defaults.objects[0].up).toBe("z+");
    expect(defaults.objects[0].clear).toBe(DEFAULTS.clearance);
  });

  it("saves, lists, renames, and deletes user presets without touching Defaults", () => {
    const store = memoryStore();
    expect(listPresets(store).map((p) => p.name)).toEqual(["Defaults"]);
    const settings = { ...defaultSettings(), pocketDepth: 24, footprint: "bed" as const, bed: "333x418" as const };
    const obj = newObject(0);
    obj.up = "z-";
    obj.clear = 0.4;
    const saved = capturePreset("Placa 24", settings, [obj]);
    expect(saveUserPresets(store, [defaultsPreset(), saved])).toBe(true);
    const listed = listPresets(store);
    expect(listed.map((p) => p.id)[0]).toBe(BUILTIN_DEFAULTS_ID);
    expect(listed[1].name).toBe("Placa 24");
    expect(listed[1].settings.pocketDepth).toBe(24);
    expect(listed[1].objects[0].up).toBe("z-");
    expect(store.read(PRESET_KEY)).not.toContain(BUILTIN_DEFAULTS_ID);

    const renamed = loadUserPresets(store).map((p) => ({ ...p, name: "Placa profunda" }));
    saveUserPresets(store, renamed);
    expect(listPresets(store).map((p) => p.name)).toEqual(["Defaults", "Placa profunda"]);

    saveUserPresets(store, []);
    expect(listPresets(store)).toHaveLength(1);
    expect(listPresets(store)[0].readonly).toBe(true);
  });

  it("flags drift from the loaded preset and applies object params without geometry", () => {
    const preset = defaultsPreset();
    const obj = newObject(0);
    obj.name = "placa";
    obj.stlName = "placa.stl";
    obj.rectW = 80;
    obj.rectH = 40;
    const settings = defaultSettings();
    expect(presetDiffers(preset, settings, [obj])).toBe(false);

    const deep = { ...settings, pocketDepth: 24 };
    expect(presetDiffers(preset, deep, [obj])).toBe(true);

    const flipped = applyObjectParams([{ ...obj, up: "z+" }], [{ ...preset.objects[0], up: "z-", clear: 0.5, rot: 90 }]);
    expect(flipped[0].up).toBe("z-");
    expect(flipped[0].clear).toBe(0.5);
    expect(flipped[0].rot).toBe(90);
    expect(flipped[0].stlName).toBe("placa.stl");
    expect(flipped[0].rectW).toBe(80);
    expect(flipped[0].name).toBe("placa");
    expect(presetDiffers(preset, settings, flipped)).toBe(true);
  });
});
