/** @vitest-environment jsdom */

import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { FrameDownload } from "./FrameDownload";
import { FRAME_DOWNLOAD_HINT, FRAME_PARTS, frameAssetUrl } from "./frameDownload";

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

let root: Root | null = null;
let host: HTMLDivElement | null = null;

function mount() {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root!.render(createElement(FrameDownload));
  });
  return host;
}

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  host?.remove();
  root = null;
  host = null;
});

describe("FrameDownload", () => {
  it("offers both STLs from BASE_URL and the print hint", () => {
    const node = mount();
    expect(node.querySelector(".frame-download-label")?.textContent).toBe("Descargar marco");
    const links = [...node.querySelectorAll("a")];
    expect(links.map((a) => a.textContent)).toEqual(FRAME_PARTS.map((part) => part.label));
    expect(links.map((a) => a.getAttribute("href"))).toEqual(
      FRAME_PARTS.map((part) => frameAssetUrl(import.meta.env.BASE_URL, part.file)),
    );
    expect(links.map((a) => a.getAttribute("download"))).toEqual(FRAME_PARTS.map((part) => part.file));
    expect(node.querySelector(".hint")?.textContent).toBe(FRAME_DOWNLOAD_HINT);
    expect(import.meta.env.BASE_URL.endsWith("/")).toBe(true);
  });
});
