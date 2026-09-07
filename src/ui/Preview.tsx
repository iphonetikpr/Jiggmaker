import { useEffect, useRef } from "react";
import { LAYER_SVG } from "../constants";
import type { Entity, JigResult, PreviewMode } from "../types";

function colorOf(e: Entity): string {
  return e.color || LAYER_SVG[(e.layer || "").toUpperCase()] || "#888";
}

function drawEntities(
  ctx: CanvasRenderingContext2D,
  entities: Entity[],
  ox: number,
  oy: number,
  sc: number,
  height: number,
  showText: boolean,
) {
  const X = (x: number) => ox + x * sc;
  const Y = (y: number) => oy + (height - y) * sc;
  for (const e of entities) {
    const col = colorOf(e);
    if (e.type === "circle" && e.cx != null && e.cy != null && e.r != null) {
      ctx.beginPath();
      ctx.arc(X(e.cx), Y(e.cy), e.r * sc, 0, Math.PI * 2);
      ctx.strokeStyle = col;
      ctx.lineWidth = Math.max(1, (e.strokeWidth || 0.25) * sc);
      ctx.stroke();
      continue;
    }
    if (e.type === "text") {
      if (!showText) continue;
      ctx.fillStyle = col;
      ctx.font = `${Math.max(10, (e.size || 4) * sc)}px sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(e.text || "", X(e.x || 0), Y(e.y || 0));
      continue;
    }
    const pts = e.points;
    if (!pts?.length) continue;
    ctx.beginPath();
    ctx.moveTo(X(pts[0][0]), Y(pts[0][1]));
    for (let i = 1; i < pts.length; i++) ctx.lineTo(X(pts[i][0]), Y(pts[i][1]));
    if (e.closed) ctx.closePath();
    ctx.strokeStyle = col;
    ctx.lineWidth = Math.max(1, (e.strokeWidth || 0.2) * sc);
    ctx.stroke();
  }
}

function drawMesh(
  ctx: CanvasRenderingContext2D,
  result: JigResult,
  W: number,
  H: number,
  az: number,
  ax: number,
  zoom: number,
  color: string,
) {
  const tris = result.mesh;
  if (!tris.length) return;
  const cx = result.jig.w / 2,
    cy = result.jig.h / 2,
    cz = 4;
  const cs = Math.cos(az),
    sn = Math.sin(az);
  const ca = Math.cos(ax),
    sa = Math.sin(ax);
  let maxR = 1;
  for (const t of tris) {
    for (let i = 0; i < 9; i += 3) {
      maxR = Math.max(maxR, Math.hypot(t[i] - cx, t[i + 1] - cy, t[i + 2] - cz));
    }
  }
  const sc = (0.42 * Math.min(W, H) * zoom) / maxR;
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
  const faces: Array<{ z: number; pts: number[]; shade: number }> = [];
  const step = Math.max(1, Math.floor(tris.length / 8000));
  for (let i = 0; i < tris.length; i += step) {
    const t = tris[i];
    const a = project(t[0], t[1], t[2]);
    const b = project(t[3], t[4], t[5]);
    const c = project(t[6], t[7], t[8]);
    const area = (b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1]);
    if (area >= 0) continue;
    const ux = t[3] - t[0],
      uy = t[4] - t[1],
      uz = t[5] - t[2];
    const vx = t[6] - t[0],
      vy = t[7] - t[1],
      vz = t[8] - t[2];
    let nx = uy * vz - uz * vy,
      ny = uz * vx - ux * vz,
      nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len;
    ny /= len;
    nz /= len;
    const shade = 0.35 + 0.65 * Math.max(0, nx * 0.3 + ny * 0.15 + nz * 0.9);
    faces.push({ z: (a[2] + b[2] + c[2]) / 3, pts: [...a, ...b, ...c], shade });
  }
  faces.sort((a, b) => a.z - b.z);
  const [r, g, b] = hex(color);
  for (const f of faces) {
    ctx.beginPath();
    ctx.moveTo(f.pts[0], f.pts[1]);
    ctx.lineTo(f.pts[3], f.pts[4]);
    ctx.lineTo(f.pts[6], f.pts[7]);
    ctx.closePath();
    ctx.fillStyle = `rgb(${(r * f.shade) | 0},${(g * f.shade) | 0},${(b * f.shade) | 0})`;
    ctx.fill();
  }
}

function hex(c: string): [number, number, number] {
  const n = c.replace("#", "");
  return [parseInt(n.slice(0, 2), 16), parseInt(n.slice(2, 4), 16), parseInt(n.slice(4, 6), 16)];
}

export function Preview({
  result,
  mode,
  showNum,
  jigColor,
  onMove,
}: {
  result: JigResult | null;
  mode: PreviewMode;
  showNum: boolean;
  jigColor: string;
  onMove: (label: string, dx: number, dy: number) => void;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const view = useRef({ zoom: 1, panx: 0, pany: 0, az: 0.6, ax: -0.9 });
  const drag = useRef<{ kind: "pan" | "orbit" | "piece" | null; x: number; y: number; label?: string }>({
    kind: null,
    x: 0,
    y: 0,
  });
  const latest = useRef({ result, mode, showNum, jigColor, onMove });
  latest.current = { result, mode, showNum, jigColor, onMove };

  const paintRef = useRef<() => void>(() => {});

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const parent = canvas.parentElement!;

    const paint = () => {
      const { result, mode, showNum, jigColor } = latest.current;
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
      ctx.clearRect(0, 0, W, H);
      if (!result) {
        ctx.fillStyle = "#8b9aab";
        ctx.font = "14px sans-serif";
        ctx.fillText("Añade un objeto para previsualizar", 24, 36);
        return;
      }
      if (mode === "jig3d") {
        drawMesh(ctx, result, W, H, view.current.az, view.current.ax, view.current.zoom, jigColor);
        return;
      }
      const dw = mode === "template" ? result.template.bed.w : result.jig.w;
      const dh = mode === "template" ? result.template.bed.h : result.jig.h;
      const ents =
        mode === "template"
          ? result.template.entities
          : mode === "laserBase"
            ? result.laser.baseEntities
            : result.laser.pocketEntities;
      const sc0 = Math.min((W - 48) / dw, (H - 48) / dh);
      const sc = sc0 * view.current.zoom;
      const ox = (W - dw * sc) / 2 + view.current.panx;
      const oy = (H - dh * sc) / 2 + view.current.pany;
      ctx.fillStyle = "rgba(26,34,44,0.9)";
      ctx.fillRect(ox, oy, dw * sc, dh * sc);
      drawEntities(ctx, ents, ox, oy, sc, dh, showNum);
    };
    paintRef.current = paint;

    const ro = new ResizeObserver(() => paint());
    ro.observe(parent);

    const mmPerPx = () => {
      const { result, mode } = latest.current;
      if (!result) return 1;
      const rect = canvas.getBoundingClientRect();
      const dw = mode === "template" ? result.template.bed.w : result.jig.w;
      const dh = mode === "template" ? result.template.bed.h : result.jig.h;
      const sc0 = Math.min((rect.width - 48) / dw, (rect.height - 48) / dh);
      return sc0 * view.current.zoom;
    };

    const hitLabel = (ev: PointerEvent) => {
      const { result, mode } = latest.current;
      if (!result || mode !== "template") return null;
      const rect = canvas.getBoundingClientRect();
      const dw = result.template.bed.w;
      const dh = result.template.bed.h;
      const sc = mmPerPx();
      const ox = (rect.width - dw * sc) / 2 + view.current.panx;
      const oy = (rect.height - dh * sc) / 2 + view.current.pany;
      const x = (ev.clientX - rect.left - ox) / sc;
      const y = dh - (ev.clientY - rect.top - oy) / sc;
      for (let i = result.placed.length - 1; i >= 0; i--) {
        const p = result.placed[i];
        if (x >= p.x && x <= p.x + p.w && y >= p.y && y <= p.y + p.h) return p.label;
      }
      return null;
    };

    const down = (ev: PointerEvent) => {
      canvas.setPointerCapture(ev.pointerId);
      if (latest.current.mode === "jig3d") {
        drag.current = { kind: "orbit", x: ev.clientX, y: ev.clientY };
        return;
      }
      const label = hitLabel(ev);
      drag.current = label
        ? { kind: "piece", x: ev.clientX, y: ev.clientY, label }
        : { kind: "pan", x: ev.clientX, y: ev.clientY };
    };
    const move = (ev: PointerEvent) => {
      if (!drag.current.kind) return;
      if (drag.current.kind === "orbit") {
        view.current.az += (ev.clientX - drag.current.x) * 0.01;
        view.current.ax = Math.max(-3, Math.min(-0.05, view.current.ax - (ev.clientY - drag.current.y) * 0.01));
        drag.current.x = ev.clientX;
        drag.current.y = ev.clientY;
        paint();
        return;
      }
      if (drag.current.kind === "pan") {
        view.current.panx += ev.clientX - drag.current.x;
        view.current.pany += ev.clientY - drag.current.y;
        drag.current.x = ev.clientX;
        drag.current.y = ev.clientY;
        paint();
        return;
      }
      if (drag.current.kind === "piece" && drag.current.label) {
        const sc = mmPerPx();
        latest.current.onMove(drag.current.label, (ev.clientX - drag.current.x) / sc, -(ev.clientY - drag.current.y) / sc);
        drag.current.x = ev.clientX;
        drag.current.y = ev.clientY;
      }
    };
    const up = () => {
      drag.current.kind = null;
    };
    const wheel = (ev: WheelEvent) => {
      ev.preventDefault();
      view.current.zoom = Math.max(0.4, Math.min(12, view.current.zoom * Math.exp(-ev.deltaY * 0.0015)));
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
  }, []);

  useEffect(() => {
    paintRef.current();
  }, [result, mode, showNum, jigColor]);

  return <canvas ref={ref} />;
}
