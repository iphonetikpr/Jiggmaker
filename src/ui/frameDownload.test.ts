import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FRAME_DOWNLOAD_HINT, FRAME_PARTS, frameAssetUrl } from "./frameDownload";

describe("frameAssetUrl", () => {
  it("uses the Docker / local root", () => {
    expect(frameAssetUrl("/", "marco_E1_izq.stl")).toBe("/frame/marco_E1_izq.stl");
    expect(frameAssetUrl("/", "marco_E1_der.stl")).toBe("/frame/marco_E1_der.stl");
  });

  it("prefixes the GitHub Pages repo subpath", () => {
    expect(frameAssetUrl("/Jiggmaker/", "marco_E1_izq.stl")).toBe("/Jiggmaker/frame/marco_E1_izq.stl");
    expect(frameAssetUrl("/Jiggmaker/", "marco_E1_der.stl")).toBe("/Jiggmaker/frame/marco_E1_der.stl");
  });

  it("adds a missing trailing slash on the base", () => {
    expect(frameAssetUrl("/Jiggmaker", "marco_E1_izq.stl")).toBe("/Jiggmaker/frame/marco_E1_izq.stl");
    expect(frameAssetUrl("", "marco_E1_der.stl")).toBe("/frame/marco_E1_der.stl");
  });
});

describe("frame download copy", () => {
  it("names both pieces and the print hint", () => {
    expect(FRAME_PARTS.map((part) => part.label)).toEqual(["Marco izquierdo (STL)", "Marco derecho (STL)"]);
    expect(FRAME_PARTS.map((part) => part.file)).toEqual(["marco_E1_izq.stl", "marco_E1_der.stl"]);
    expect(FRAME_DOWNLOAD_HINT).toBe(
      "Imprime las dos piezas con el tope hacia la cama; el hueco es 334.5 × 90.4 mm para el jig Mini de 334 × 90.",
    );
  });

  it("ships the STL files that the links point at", () => {
    for (const part of FRAME_PARTS) {
      const path = new URL(`../../public/frame/${part.file}`, import.meta.url);
      expect(existsSync(path), part.file).toBe(true);
    }
  });
});
