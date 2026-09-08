/** @vitest-environment jsdom */

import { createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { NumberField } from "./NumberField";

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

let root: Root | null = null;
let host: HTMLDivElement | null = null;

function mount(node: ReturnType<typeof createElement>) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root!.render(node);
  });
  return host.querySelector("input")!;
}

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  host?.remove();
  root = null;
  host = null;
});

const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;

function typeValue(input: HTMLInputElement, raw: string) {
  act(() => {
    input.focus();
    valueSetter?.call(input, raw);
    input.dispatchEvent(new InputEvent("input", { bubbles: true, data: raw, inputType: "insertText" }));
  });
}

describe("NumberField keyboard entry", () => {
  it("accepts qty=3 by typing over the current value", () => {
    const seen: number[] = [];
    const input = mount(
      createElement(NumberField, {
        value: 1,
        min: 1,
        step: 1,
        "aria-label": "qty",
        onChange: (n: number) => {
          seen.push(n);
        },
      }),
    );
    typeValue(input, "3");
    expect(seen.at(-1)).toBe(3);
    expect(input.value).toBe("3");
  });

  it("lets the user type clearance 0.2 including the decimal point", () => {
    function Harness() {
      const [value, setValue] = useState(0.15);
      return createElement(NumberField, {
        value,
        min: 0,
        max: 3,
        step: 0.05,
        "aria-label": "Clearance mm",
        onChange: setValue,
      });
    }
    const input = mount(createElement(Harness));
    for (const raw of ["0", "0.", "0.2"]) {
      typeValue(input, raw);
      expect(input.value).toBe(raw);
    }
    expect(Number(input.value)).toBeCloseTo(0.2, 8);
    act(() => {
      input.blur();
    });
    expect(Number(input.value)).toBeCloseTo(0.2, 8);
  });
});
