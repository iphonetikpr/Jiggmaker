import { useEffect, useRef, useState } from "react";
import { meshFromBytes } from "../cad/prepare";
import { orientPoint } from "../cad/project";
import type { JobObject, StlMesh, UpAxis } from "../types";
import { flipUp } from "./summary";

function hex(c: string): [number, number, number] {
  const n = c.replace("#", "");
  return [parseInt(n.slice(0, 2), 16), parseInt(n.slice(2, 4), 16), parseInt(n.slice(4, 6), 16)];
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
  color: string,
) {
  const p = mesh.positions;
  const pts: Array<[number, number, number]> = new Array(mesh.count * 3);
  let minX = Infinity,
    minY = Infinity,
    minZ = Infinity,
    maxX = -Infinity,
    maxY = -Infinity,
    maxZ = -Infinity;
  for (let i = 0, g = 0, k = 0; i < mesh.count; i++) {
    for (let v = 0; v < 3; v++, g += 3, k++) {
      const q = orientPoint(p[g], p[g + 1], p[g + 2], up, rot, mirror);
      pts[k] = q;
      if (q[0] < minX) minX = q[0];
      if (q[1] < minY) minY = q[1];
      if (q[2] < minZ) minZ = q[2];
      if (q[0] > maxX) maxX = q[0];
      if (q[1] > maxY) maxY = q[1];
      if (q[2] > maxZ) maxZ = q[2];
    }
  }
  const cx = (minX + maxX) / 2,
    cy = (minY + maxY) / 2,
    cz = (minZ + maxZ) / 2;
  let maxR = 1;
  for (const q of pts) maxR = Math.max(maxR, Math.hypot(q[0] - cx, q[1] - cy, q[2] - cz));
  const sc = (0.42 * Math.min(W, H)) / maxR;
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
  const faces: Array<{ z: number; a: [number, number, number]; b: [number, number, number]; c: [number, number, number]; shade: number }> =
    [];
  const step = Math.max(1, Math.floor(mesh.count / 6000));
  for (let i = 0; i < mesh.count; i += step) {
    const A = project(...pts[i * 3]);
    const B = project(...pts[i * 3 + 1]);
    const C = project(...pts[i * 3 + 2]);
    const area = (B[0] - A[0]) * (C[1] - A[1]) - (C[0] - A[0]) * (B[1] - A[1]);
    if (area >= 0) continue;
    const t0 = pts[i * 3],
      t1 = pts[i * 3 + 1],
      t2 = pts[i * 3 + 2];
    const ux = t1[0] - t0[0],
      uy = t1[1] - t0[1],
      uz = t1[2] - t0[2];
    const vx = t2[0] - t0[0],
      vy = t2[1] - t0[1],
      vz = t2[2] - t0[2];
    let nx = uy * vz - uz * vy,
      ny = uz * vx - ux * vz,
      nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    const shade = 0.28 + 0.72 * Math.max(0, (nx * 0.25 + ny * 0.2 + nz * 0.9) / len);
    faces.push({ z: (A[2] + B[2] + C[2]) / 3, a: A, b: B, c: C, shade });
  }
  faces.sort((a, b) => a.z - b.z);
  const [r, g, b] = hex(color);
  for (const f of faces) {
    ctx.beginPath();
    ctx.moveTo(f.a[0], f.a[1]);
    ctx.lineTo(f.b[0], f.b[1]);
    ctx.lineTo(f.c[0], f.c[1]);
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
  const view = useRef({ az: 0.55, ax: -0.85 });
  const drag = useRef<{ x: number; y: number } | null>(null);

  const withStl = objects
    .map((o, i) => ({ o, i, buf: stlMap[o.id] || null }))
    .filter((x) => x.buf && x.o.stlName);
  const idx = Math.min(sel, Math.max(0, withStl.length - 1));
  const current = withStl[idx] || null;

  useEffect(() => {
    if (sel >= withStl.length) setSel(0);
  }, [sel, withStl.length]);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const parent = canvas.parentElement;
    if (!parent) return;

    const paint = () => {
      const dpr = window.devicePixelRatio || 1;
      const W = parent.clientWidth;
      const H = parent.clientHeight;
      canvas.width = Math.max(1, W * dpr);
      canvas.height = Math.max(1, H * dpr);
      canvas.style.width = W + "px";
      canvas.style.height = H + "px";
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = "#0b1016";
      ctx.fillRect(0, 0, W, H);
      if (!current?.buf) {
        ctx.fillStyle = "#8b9aab";
        ctx.font = "13px sans-serif";
        ctx.textAlign = "center";
        ctx.fillText("Sube un STL para ver la pieza", W / 2, H / 2);
        return;
      }
      try {
        const mesh = meshFromBytes(current.buf);
        drawPart(ctx, mesh, current.o.up, current.o.rot, current.o.mirror, W, H, view.current.az, view.current.ax, "#D5DCE4");
      } catch {
        ctx.fillStyle = "#8b9aab";
        ctx.font = "13px sans-serif";
        ctx.textAlign = "center";
        ctx.fillText("STL inválido", W / 2, H / 2);
      }
    };

    const ro = new ResizeObserver(() => paint());
    ro.observe(parent);
    const down = (ev: PointerEvent) => {
      canvas.setPointerCapture(ev.pointerId);
      drag.current = { x: ev.clientX, y: ev.clientY };
    };
    const move = (ev: PointerEvent) => {
      if (!drag.current) return;
      view.current.az += (ev.clientX - drag.current.x) * 0.012;
      view.current.ax = Math.max(-2.6, Math.min(-0.15, view.current.ax - (ev.clientY - drag.current.y) * 0.012));
      drag.current = { x: ev.clientX, y: ev.clientY };
      paint();
    };
    const up = () => {
      drag.current = null;
    };
    canvas.addEventListener("pointerdown", down);
    canvas.addEventListener("pointermove", move);
    canvas.addEventListener("pointerup", up);
    canvas.addEventListener("pointercancel", up);
    paint();
    return () => {
      ro.disconnect();
      canvas.removeEventListener("pointerdown", down);
      canvas.removeEventListener("pointermove", move);
      canvas.removeEventListener("pointerup", up);
      canvas.removeEventListener("pointercancel", up);
    };
  }, [current, current?.o.up, current?.o.rot, current?.o.mirror, current?.buf]);

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
        <button
          className="seats-btn"
          type="button"
          disabled={!current}
          onClick={() => current && onChange(current.o.id, { up: flipUp(current.o.up) })}
        >
          ▼ seats down
        </button>
      </div>
      <p className="hint">La cara de asiento mira hacia abajo en el pocket. Flip invierte el eje up.</p>
    </section>
  );
}
