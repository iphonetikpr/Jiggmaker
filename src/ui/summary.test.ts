import { describe, expect, it } from "vitest";
import { DEFAULTS } from "../constants";
import { generateJig } from "../cad/generate";
import { defaultSettings, newObject } from "../cad/history";
import { makeLStl } from "../cad/stl";
import { meshFromBytes } from "../cad/prepare";
import { orientedPartBounds } from "./partView";
import { flipUp, summaryBedLine, summaryJigSize, summaryPlateHint, truncateName } from "./summary";

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
    const mini = generateJig([obj], {}, defaultSettings(), {});
    expect(summaryBedLine(mini)).toBe("Mini · 333 × 88 mm");
    expect(summaryJigSize(mini)).toBe("333 × 88 mm");
    expect(summaryPlateHint(mini)).toBeNull();
    expect(mini.totalUnits).toBe(2);
    expect(mini.mesh.length).toBeGreaterThan(8);

    const frame = generateJig([obj], {}, { ...defaultSettings(), useAdapter: true }, {});
    expect(summaryBedLine(frame)).toBe("Mini · 333 × 88 mm");
    expect(summaryJigSize(frame)).toBe("334 × 90 mm");
    expect(summaryPlateHint(frame)).toBe("frame 334×90");

    const large = generateJig([obj], {}, { ...defaultSettings(), bed: "333x418" }, {});
    expect(summaryBedLine(large)).toBe("Large · 333 × 418 mm");
  });

  it("truncates long object names", () => {
    expect(truncateName("tapita-clicker-base-v2", 18)).toMatch(/…$/);
    expect(truncateName("coin")).toBe("coin");
  });

  it("reports default clearance lock", () => {
    expect(DEFAULTS.clearance).toBe(0.15);
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
