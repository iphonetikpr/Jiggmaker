import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { meshFromBytes } from "../cad/prepare";
import { orientPoint } from "../cad/project";
import type { JobObject, StlMesh, UpAxis } from "../types";
import { flipUp } from "./summary";

function hex(c: string): [number, number, number] {
  const n = c.replace("#", "");
  return [parseInt(n.slice(0, 2), 16), parseInt(n.slice(2, 4), 16), parseInt(n.slice(4, 6), 16)];
}

export function orientedPartBounds(
  mesh: StlMesh,
  up: UpAxis,
  rot: number,
  mirror: boolean,
): { count: number; radius: number } {
  const p = mesh.positions;
  let minX = Infinity,
    minY = Infinity,
    minZ = Infinity,
    maxX = -Infinity,
    maxY = -Infinity,
    maxZ = -Infinity;
  for (let g = 0; g < p.length; g += 3) {
    const q = orientPoint(p[g], p[g + 1], p[g + 2], up, rot, mirror);
    if (q[0] < minX) minX = q[0];
    if (q[1] < minY) minY = q[1];
    if (q[2] < minZ) minZ = q[2];
    if (q[0] > maxX) maxX = q[0];
    if (q[1] > maxY) maxY = q[1];
    if (q[2] > maxZ) maxZ = q[2];
  }
  const radius = Math.hypot(maxX - minX, maxY - minY, maxZ - minZ) / 2 || 1;
  return { count: mesh.count, radius };
}

function drawPart(
  ctx: CanvasRenderingContext2D,
  mesh: StlMesh,
  up: UpAxis,
  rot: number,
  mirror: boolean,
  W: number,
  H: number,
  az: number,
  ax: number,
  zoom: number,
  color: string,
) {
  const p = mesh.positions;
  const n = mesh.count;
  const pts = new Float32Array(n * 9);
  let minX = Infinity,
    minY = Infinity,
    minZ = Infinity,
    maxX = -Infinity,
    maxY = -Infinity,
    maxZ = -Infinity;
  for (let i = 0, g = 0; i < n * 9; i += 3, g += 3) {
    const q = orientPoint(p[g], p[g + 1], p[g + 2], up, rot, mirror);
    pts[i] = q[0];
    pts[i + 1] = q[1];
    pts[i + 2] = q[2];
    if (q[0] < minX) minX = q[0];
    if (q[1] < minY) minY = q[1];
    if (q[2] < minZ) minZ = q[2];
    if (q[0] > maxX) maxX = q[0];
    if (q[1] > maxY) maxY = q[1];
    if (q[2] > maxZ) maxZ = q[2];
  }
  const cx = (minX + maxX) / 2,
    cy = (minY + maxY) / 2,
    cz = (minZ + maxZ) / 2;
  let maxR = 1;
  for (let i = 0; i < pts.length; i += 3) {
    maxR = Math.max(maxR, Math.hypot(pts[i] - cx, pts[i + 1] - cy, pts[i + 2] - cz));
  }
  const sc = (0.46 * Math.min(W, H) * zoom) / maxR;
  const cs = Math.cos(az),
    sn = Math.sin(az);
  const ca = Math.cos(ax),
    sa = Math.sin(ax);
  const project = (x: number, y: number, z: number): [number, number, number] => {
    const dx = x - cx,
      dy = y - cy,
      dz = z - cz;
    const rx = dx * cs - dy * sn;
    const ry = dx * sn + dy * cs;
    const rz = ry * sa + dz * ca;
    const py = ry * ca - dz * sa;
    return [W / 2 + rx * sc, H / 2 - py * sc, rz];
  };
  const faces: Array<{ z: number; x0: number; y0: number; x1: number; y1: number; x2: number; y2: number; shade: number }> = [];
  const step = Math.max(1, Math.floor(n / 8000));
  for (let i = 0; i < n; i += step) {
    const o = i * 9;
    const A = project(pts[o], pts[o + 1], pts[o + 2]);
    const B = project(pts[o + 3], pts[o + 4], pts[o + 5]);
    const C = project(pts[o + 6], pts[o + 7], pts[o + 8]);
    const ux = pts[o + 3] - pts[o],
      uy = pts[o + 4] - pts[o + 1],
      uz = pts[o + 5] - pts[o + 2];
    const vx = pts[o + 6] - pts[o],
      vy = pts[o + 7] - pts[o + 1],
      vz = pts[o + 8] - pts[o + 2];
    let nx = uy * vz - uz * vy,
      ny = uz * vx - ux * vz,
      nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    const shade = 0.22 + 0.78 * Math.abs((nx * 0.2 + ny * 0.25 + nz * 0.85) / len);
    faces.push({ z: (A[2] + B[2] + C[2]) / 3, x0: A[0], y0: A[1], x1: B[0], y1: B[1], x2: C[0], y2: C[1], shade });
  }
  faces.sort((a, b) => a.z - b.z);
  const [r, g, b] = hex(color);
  for (const f of faces) {
    ctx.beginPath();
    ctx.moveTo(f.x0, f.y0);
    ctx.lineTo(f.x1, f.y1);
    ctx.lineTo(f.x2, f.y2);
    ctx.closePath();
    ctx.fillStyle = `rgb(${(r * f.shade) | 0},${(g * f.shade) | 0},${(b * f.shade) | 0})`;
    ctx.fill();
  }
}

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
      const W = Math.max(1, parent.clientWidth);
      const H = Math.max(1, parent.clientHeight);
      canvas.width = Math.max(1, Math.round(W * dpr));
      canvas.height = Math.max(1, Math.round(H * dpr));
      canvas.style.width = W + "px";
      canvas.style.height = H + "px";
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = getComputedStyle(parent).backgroundColor || "#243040";
      ctx.fillRect(0, 0, W, H);
      if (!current) {
        ctx.fillStyle = "#8b9aab";
        ctx.font = "13px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("Sube un STL para ver la pieza", W / 2, H / 2);
        return;
      }
      try {
        const mesh = meshFromBytes(current.buf);
        drawPart(
          ctx,
          mesh,
          current.o.up,
          current.o.rot,
          current.o.mirror,
          W,
          H,
          view.current.az,
          view.current.ax,
          view.current.zoom,
          "#E4EAF1",
        );
      } catch {
        ctx.fillStyle = "#8b9aab";
        ctx.font = "13px sans-serif";
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
        <canvas ref={ref} />
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
