import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { THEME_KEY } from "./theme";

const DARK_TOKENS = {
  "--bg": "#0F1419",
  "--surface": "#1A222C",
  "--surface-2": "#243040",
  "--border": "#2E3A4A",
  "--text": "#E8EEF4",
  "--muted": "#8B9AAB",
  "--accent": "#3DDC97",
  "--accent-2": "#5B8DEF",
  "--cut": "#E74C3C",
  "--score": "#3B82F6",
  "--bed": "#6B7280",
  "--warn": "#F5A623",
  "--ok": "#22C55E",
} as const;

const LIGHT_TOKENS = {
  "--bg": "#F4F6F8",
  "--surface": "#FFFFFF",
  "--surface-2": "#EEF1F5",
  "--border": "#D0D7E0",
  "--text": "#1A222C",
  "--muted": "#5B6B7C",
  "--accent": "#0F9F6E",
  "--accent-2": "#3B6FD9",
} as const;

function blockAfter(css: string, marker: string): string {
  const i = css.indexOf(marker);
  expect(i).toBeGreaterThan(-1);
  const open = css.indexOf("{", i);
  const close = css.indexOf("}", open);
  return css.slice(open, close + 1);
}

describe("theme tokens", () => {
  it("keeps dark tokens v1 as :root default and light tokens on data-theme", () => {
    const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
    const root = blockAfter(css, ":root");
    for (const [name, value] of Object.entries(DARK_TOKENS)) {
      expect(root).toContain(`${name}: ${value}`);
    }
    const light = blockAfter(css, 'html[data-theme="light"]');
    for (const [name, value] of Object.entries(LIGHT_TOKENS)) {
      expect(light).toContain(`${name}: ${value}`);
    }
    for (const name of ["--cut", "--score", "--bed", "--warn", "--ok"] as const) {
      expect(light).not.toContain(`${name}:`);
    }
  });

  it("bootstraps from jiggmaker.theme before paint", () => {
    expect(THEME_KEY).toBe("jiggmaker.theme");
    const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
    expect(html).toContain('localStorage.getItem("jiggmaker.theme")');
    expect(html).toContain('data-theme", "light"');
  });
});
