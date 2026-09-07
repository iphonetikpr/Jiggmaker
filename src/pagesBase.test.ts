import { describe, expect, it } from "vitest";
import { publicBase } from "./pagesBase";

describe("publicBase", () => {
  it("is root for Docker / local builds", () => {
    expect(publicBase({})).toBe("/");
    expect(publicBase({ GITHUB_PAGES: "false" })).toBe("/");
  });

  it("uses the repo name for GitHub Pages", () => {
    expect(publicBase({ GITHUB_PAGES: "true", GITHUB_REPOSITORY: "iphonetikpr/Jiggmaker" })).toBe("/Jiggmaker/");
    expect(publicBase({ GITHUB_PAGES: "true" })).toBe("/Jiggmaker/");
  });
});
