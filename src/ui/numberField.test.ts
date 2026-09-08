import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { clampNumber, parseNumberDraft, stepNumber } from "./numberField";

describe("parseNumberDraft", () => {
  it("parses typed quantities and measurements", () => {
    expect(parseNumberDraft("3")).toBe(3);
    expect(parseNumberDraft("0.2")).toBe(0.2);
    expect(parseNumberDraft("0,2")).toBe(0.2);
    expect(parseNumberDraft(" 12.5 ")).toBe(12.5);
    expect(parseNumberDraft("-1.5")).toBe(-1.5);
  });

  it("keeps in-progress keystrokes from becoming NaN", () => {
    expect(parseNumberDraft("")).toBeNull();
    expect(parseNumberDraft(".")).toBeNull();
    expect(parseNumberDraft("-")).toBeNull();
    expect(parseNumberDraft("-.")).toBeNull();
    expect(parseNumberDraft("abc")).toBeNull();
    expect(parseNumberDraft("0.")).toBe(0);
  });
});

describe("clampNumber / stepNumber", () => {
  it("applies min/max only when committing", () => {
    expect(clampNumber(0.2, 0, 3)).toBe(0.2);
    expect(clampNumber(0.2, 0.5)).toBe(0.5);
    expect(clampNumber(150, 100, 100)).toBe(100);
    expect(clampNumber(3, 1)).toBe(3);
  });

  it("steps without blocking a later typed value", () => {
    expect(stepNumber(0.15, 1, 0.05, 0, 3)).toBeCloseTo(0.2, 8);
    expect(stepNumber(1, 1, 1, 1)).toBe(2);
    expect(stepNumber(1, -1, 1, 1)).toBe(1);
  });
});

describe("numeric fields in the UI", () => {
  it("uses NumberField for every quantity and measurement control", () => {
    const app = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
    const card = readFileSync(new URL("./ObjectCard.tsx", import.meta.url), "utf8");
    expect(app).toContain("NumberField");
    expect(card).toContain("NumberField");
    expect(app).not.toMatch(/type=["']number["']/);
    expect(card).not.toMatch(/type=["']number["']/);
    for (const label of [
      "qty",
      "Clearance mm",
      "Spacing X mm",
      "Margin X mm",
      "Gap entre objetos mm",
      "Row offset percent",
      "Base thickness mm",
      "Pocket depth mm",
      "Material thickness mm",
      "PNG DPI",
      "Pick-out hole diameter mm",
      "Bed width mm",
    ]) {
      expect(app + card).toContain(`aria-label="${label}"`);
    }
  });
});
