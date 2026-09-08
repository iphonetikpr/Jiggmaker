/** @vitest-environment jsdom */

import { afterEach, describe, expect, it } from "vitest";
import { applyTheme, persistTheme, readStoredTheme, THEME_KEY, toggleTheme } from "./theme";

afterEach(() => {
  localStorage.removeItem(THEME_KEY);
  document.documentElement.removeAttribute("data-theme");
});

describe("theme persistence", () => {
  it("defaults to dark and does not set data-theme", () => {
    expect(readStoredTheme()).toBe("dark");
    applyTheme("dark");
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
  });

  it("persists light and survives a re-read", () => {
    persistTheme("light");
    expect(localStorage.getItem(THEME_KEY)).toBe("light");
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    expect(readStoredTheme()).toBe("light");
  });

  it("toggles dark ↔ light", () => {
    expect(toggleTheme("dark")).toBe("light");
    expect(toggleTheme("light")).toBe("dark");
  });
});
