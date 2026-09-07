import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { meshFromBytes } from "../cad/prepare";
import type { JobObject } from "../types";
import { PART_VIEW, renderOrientedMesh } from "./partView";
import { flipUp } from "./summary";

const MESH_COLOR: [number, number, number] = [228, 234, 241];
const MESH_BG: [number, number, number] = [36, 48, 64];

export { orientedPartBounds } from "./partView";

export function PartViewport({
  objects,
  stlMap,
  onChange,
}: {
  objects: JobObject[];
  stlMap: Record<string, ArrayBuffer | null>;
  onChange: (id: string, patch: Partial<JobObject>) => void;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [sel, setSel] = useState(0);
  const view = useRef({ az: 0.7, ax: -0.7, zoom: 1 });
  const drag = useRef<{ x: number; y: number } | null>(null);
  const paintRef = useRef<() => void>(() => {});

  const withStl = useMemo(
    () =>
      objects
        .map((o, i) => ({ o, i, buf: stlMap[o.id] || null }))
        .filter((x): x is { o: JobObject; i: number; buf: ArrayBuffer } => !!x.buf && !!x.o.stlName),
    [objects, stlMap],
  );
  const idx = withStl.length ? Math.min(sel, withStl.length - 1) : 0;
  const current = withStl[idx] || null;

  useEffect(() => {
    if (sel >= withStl.length) setSel(0);
  }, [sel, withStl.length]);

  useLayoutEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const parent = canvas.parentElement;
    if (!parent) return;

    const paint = () => {
      const dpr = window.devicePixelRatio || 1;
      const box = parent.getBoundingClientRect();
      const cssW = Math.max(1, box.width || PART_VIEW.w);
      const cssH = Math.max(1, box.height || PART_VIEW.h);
      const W = Math.max(1, Math.round(cssW * dpr));
      const H = Math.max(1, Math.round(cssH * dpr));
      if (canvas.width !== W) canvas.width = W;
      if (canvas.height !== H) canvas.height = H;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      if (!current) {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.fillStyle = "#243040";
        ctx.fillRect(0, 0, W, H);
        ctx.fillStyle = "#8b9aab";
        ctx.font = `${Math.round(13 * dpr)}px sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("Sube un STL para ver la pieza", W / 2, H / 2);
        return;
      }
      try {
        const mesh = meshFromBytes(current.buf);
        const frame = renderOrientedMesh(
          mesh,
          current.o.up,
          current.o.rot,
          current.o.mirror,
          W,
          H,
          view.current.az,
          view.current.ax,
          view.current.zoom,
          MESH_COLOR,
          MESH_BG,
        );
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        const img = ctx.createImageData(frame.w, frame.h);
        img.data.set(frame.data);
        ctx.putImageData(img, 0, 0);
      } catch {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.fillStyle = "#243040";
        ctx.fillRect(0, 0, W, H);
        ctx.fillStyle = "#8b9aab";
        ctx.font = `${Math.round(13 * dpr)}px sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("STL inválido", W / 2, H / 2);
      }
    };
    paintRef.current = paint;

    const ro = new ResizeObserver(() => paint());
    ro.observe(parent);
    const down = (ev: PointerEvent) => {
      canvas.setPointerCapture(ev.pointerId);
      drag.current = { x: ev.clientX, y: ev.clientY };
    };
    const move = (ev: PointerEvent) => {
      if (!drag.current) return;
      view.current.az += (ev.clientX - drag.current.x) * 0.012;
      view.current.ax = Math.max(-2.8, Math.min(-0.08, view.current.ax - (ev.clientY - drag.current.y) * 0.012));
      drag.current = { x: ev.clientX, y: ev.clientY };
      paint();
    };
    const up = () => {
      drag.current = null;
    };
    const wheel = (ev: WheelEvent) => {
      ev.preventDefault();
      view.current.zoom = Math.max(0.35, Math.min(8, view.current.zoom * Math.exp(-ev.deltaY * 0.0018)));
      paint();
    };
    canvas.addEventListener("pointerdown", down);
    canvas.addEventListener("pointermove", move);
    canvas.addEventListener("pointerup", up);
    canvas.addEventListener("pointercancel", up);
    canvas.addEventListener("wheel", wheel, { passive: false });
    paint();
    return () => {
      ro.disconnect();
      canvas.removeEventListener("pointerdown", down);
      canvas.removeEventListener("pointermove", move);
      canvas.removeEventListener("pointerup", up);
      canvas.removeEventListener("pointercancel", up);
      canvas.removeEventListener("wheel", wheel);
    };
  }, [current]);

  useEffect(() => {
    paintRef.current();
  }, [current, current?.o.up, current?.o.rot, current?.o.mirror]);

  return (
    <section className="card orient-card">
      <h2>Orientation</h2>
      {withStl.length > 1 && (
        <div className="seg" style={{ marginBottom: 8 }}>
          {withStl.map((x, i) => (
            <button key={x.o.id} type="button" className={i === idx ? "on" : ""} onClick={() => setSel(i)}>
              {x.o.name || String.fromCharCode(65 + x.i)}
            </button>
          ))}
        </div>
      )}
      <div className="part-view">
        <canvas ref={ref} width={PART_VIEW.w} height={PART_VIEW.h} />
      </div>
      <div className="orient-actions">
        <button
          className="ghost"
          type="button"
          disabled={!current}
          onClick={() => current && onChange(current.o.id, { up: flipUp(current.o.up) })}
        >
          ▼ seats down · flip
        </button>
      </div>
      <p className="hint">Drag to orbit · scroll to zoom. Flip invierte la cara que asienta en el pocket.</p>
    </section>
  );
}
