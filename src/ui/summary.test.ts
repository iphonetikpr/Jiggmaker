import { describe, expect, it } from "vitest";
import { DEFAULTS } from "../constants";
import { generateJig } from "../cad/generate";
import { defaultSettings, newObject } from "../cad/history";
import { makeLStl } from "../cad/stl";
import { meshFromBytes } from "../cad/prepare";
import { orientedPartBounds } from "./partView";
import {
  flipUp,
  summaryBedLine,
  summaryJigSize,
  summaryPlateHint,
  summaryStlSize,
  THIN_BASE_WARNING,
  thinBaseWarning,
  truncateName,
} from "./summary";

describe("summary helpers", () => {
  it("flips seating axis", () => {
    expect(flipUp("z+")).toBe("z-");
    expect(flipUp("z-")).toBe("z+");
    expect(flipUp("x+")).toBe("x-");
  });

  it("formats Mini / Frame / Large summary lines", () => {
    const obj = newObject(0);
    obj.mode = "rectangle";
    obj.rectW = 40;
    obj.rectH = 20;
    obj.count = 2;
    const full = { ...defaultSettings(), footprint: "bed" as const };
    const mini = generateJig([obj], {}, full, {});
    expect(summaryBedLine(mini)).toBe("Mini · 333 × 88 mm");
    expect(summaryJigSize(mini)).toBe("333 × 88 mm");
    expect(summaryStlSize(mini)).toBe("333 × 88 × 5.0 mm");
    expect(summaryPlateHint(mini)).toBeNull();
    expect(mini.totalUnits).toBe(2);
    expect(mini.mesh.length).toBeGreaterThan(8);

    const frame = generateJig([obj], {}, { ...full, useAdapter: true }, {});
    expect(summaryBedLine(frame)).toBe("Mini · 333 × 88 mm");
    expect(summaryJigSize(frame)).toBe("334 × 90 mm");
    expect(summaryStlSize(frame)).toBe("334 × 90 × 5.0 mm");
    expect(summaryPlateHint(frame)).toBe("frame 334×90");

    const large = generateJig([obj], {}, { ...full, bed: "333x418" }, {});
    expect(summaryBedLine(large)).toBe("Large · 333 × 418 mm");
  });

  it("truncates long object names", () => {
    expect(truncateName("tapita-clicker-base-v2", 18)).toMatch(/…$/);
    expect(truncateName("coin")).toBe("coin");
  });

  it("reports default clearance lock", () => {
    expect(DEFAULTS.clearance).toBe(0.15);
    expect(DEFAULTS.baseThk).toBe(2);
    expect(DEFAULTS.pocketDepth).toBe(3);
  });

  it("warns only when the exported plate exceeds 200 mm and the base is under 3 mm", () => {
    expect(thinBaseWarning(333, 418, 2)).toBe(THIN_BASE_WARNING);
    expect(thinBaseWarning(144, 182, 2)).toBeNull();
    expect(thinBaseWarning(333, 418, 3)).toBeNull();
    expect(thinBaseWarning(200, 88, 2)).toBeNull();
    expect(thinBaseWarning(200.1, 10, 2.9)).toBe(THIN_BASE_WARNING);
    const large = generateJig([newObject(0)], {}, { ...defaultSettings(), bed: "333x418", footprint: "bed" }, {});
    expect(thinBaseWarning(large.jig.w, large.jig.h, large.baseThk)).toBe(THIN_BASE_WARNING);
    expect(large.baseThk).toBe(2);
  });
});

describe("part orientation mesh", () => {
  it("keeps a drawable radius for an uploaded L-shaped STL", () => {
    const mesh = meshFromBytes(makeLStl(8));
    const a = orientedPartBounds(mesh, "z+", 0, false);
    const b = orientedPartBounds(mesh, "z-", 0, false);
    expect(a.count).toBeGreaterThan(12);
    expect(a.radius).toBeGreaterThan(10);
    expect(b.radius).toBeGreaterThan(10);
  });
});
