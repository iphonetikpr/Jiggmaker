import { useEffect, useRef } from "react";
import { LAYER_SVG } from "../constants";
import type { Entity, JigResult, PreviewMode } from "../types";
import bedMiniUrl from "../assets/bed-mini.svg?url";
import bedStdUrl from "../assets/bed-std.svg?url";
import {
  type BedView,
  BED_STD,
  bedToPlate,
  fitBedView,
  plateToBed,
  plateViewSize,
  silhouetteLoopsOf,
  templateForResult,
} from "./bedPreview";

function colorOf(e: Entity): string {
  return e.color || LAYER_SVG[(e.layer || "").toUpperCase()] || "#888";
}

function rgba(c: string, a: number): string {
  const [r, g, b] = hex(c);
  return `rgba(${r},${g},${b},${a})`;
}

function drawEntities(
  ctx: CanvasRenderingContext2D,
  entities: Entity[],
  ox: number,
  oy: number,
  sc: number,
  height: number,
  showText: boolean,
  map = (x: number, y: number): [number, number] => [x, y],
) {
  const X = (x: number, y: number) => ox + map(x, y)[0] * sc;
  const Y = (x: number, y: number) => oy + (height - map(x, y)[1]) * sc;
  for (const e of entities) {
    const col = colorOf(e);
    if (e.type === "circle" && e.cx != null && e.cy != null && e.r != null) {
      const [cx, cy] = map(e.cx, e.cy);
      ctx.beginPath();
      ctx.arc(ox + cx * sc, oy + (height - cy) * sc, e.r * sc, 0, Math.PI * 2);
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
      ctx.fillText(e.text || "", X(e.x || 0, e.y || 0), Y(e.x || 0, e.y || 0));
      continue;
    }
    const pts = e.points;
    if (!pts?.length) continue;
    ctx.beginPath();
    ctx.moveTo(X(pts[0][0], pts[0][1]), Y(pts[0][0], pts[0][1]));
    for (let i = 1; i < pts.length; i++) ctx.lineTo(X(pts[i][0], pts[i][1]), Y(pts[i][0], pts[i][1]));
    if (e.closed) ctx.closePath();
    ctx.strokeStyle = col;
    ctx.lineWidth = Math.max(1, (e.strokeWidth || 0.2) * sc);
    ctx.stroke();
  }
}

function drawSilhouettes(
  ctx: CanvasRenderingContext2D,
  result: JigResult,
  view: BedView,
  plateH: number,
  showNum: boolean,
) {
  const { ox, oy, scX, scY } = view;
  const sc = (scX + scY) / 2;
  const X = (x: number, y: number) => {
    const [px] = bedToPlate(result, x, y);
    return ox + px * scX;
  };
  const Y = (x: number, y: number) => {
    const [, py] = bedToPlate(result, x, y);
    return oy + (plateH - py) * scY;
  };
  for (const p of result.placed) {
    for (const loop of silhouetteLoopsOf(p)) {
      if (loop.length < 2) continue;
      ctx.beginPath();
      ctx.moveTo(X(loop[0][0], loop[0][1]), Y(loop[0][0], loop[0][1]));
      for (let i = 1; i < loop.length; i++) ctx.lineTo(X(loop[i][0], loop[i][1]), Y(loop[i][0], loop[i][1]));
      ctx.closePath();
      ctx.fillStyle = rgba(p.color, 0.28);
      ctx.fill();
      ctx.strokeStyle = LAYER_SVG.CUT;
      ctx.lineWidth = Math.max(1.75, 0.4 * sc);
      ctx.stroke();
    }
    for (const loop of p.artHoles.length ? p.artHoles : p.holes) {
      if (loop.length < 2) continue;
      ctx.beginPath();
      ctx.moveTo(X(loop[0][0], loop[0][1]), Y(loop[0][0], loop[0][1]));
      for (let i = 1; i < loop.length; i++) ctx.lineTo(X(loop[i][0], loop[i][1]), Y(loop[i][0], loop[i][1]));
      ctx.closePath();
      ctx.strokeStyle = LAYER_SVG.SCORE;
      ctx.lineWidth = Math.max(1.25, 0.25 * sc);
      ctx.stroke();
    }
    if (showNum) {
      const [cx, cy] = bedToPlate(result, p.cx, p.cy);
      ctx.fillStyle = p.color;
      ctx.font = `600 ${Math.max(11, 4.5 * sc)}px sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(p.label, ox + cx * scX, oy + (plateH - cy) * scY);
    }
  }
}

function drawBedBackground(ctx: CanvasRenderingContext2D, img: HTMLImageElement | null, view: BedView) {
  if (img && img.complete && img.naturalWidth > 0) {
    ctx.drawImage(img, view.imgX, view.imgY, view.imgW, view.imgH);
    return;
  }
  ctx.fillStyle = "rgba(26,34,44,0.9)";
  ctx.fillRect(view.ox, view.oy, 333 * view.scX, 88 * view.scY);
}

function hex(c: string): [number, number, number] {
  const n = c.replace("#", "");
  return [parseInt(n.slice(0, 2), 16), parseInt(n.slice(2, 4), 16), parseInt(n.slice(4, 6), 16)];
}

function viewSize(result: JigResult, _mode: PreviewMode): { w: number; h: number } {
  return plateViewSize(result);
}

function drawMeshOnPlate(
  ctx: CanvasRenderingContext2D,
  result: JigResult,
  view: BedView,
  plateH: number,
  az: number,
  ax: number,
  color: string,
) {
  const tris = result.mesh;
  if (!tris.length) return;
  const { ox, oy, scX, scY } = view;
  const sc = (scX + scY) / 2;
  const cx = result.jig.w / 2,
    cy = result.jig.h / 2;
  const cs = Math.cos(az),
    sn = Math.sin(az);
  const tilt = Math.max(0.12, Math.min(1, Math.abs(ax) / 1.45));
  const lift = (1 - tilt) * 0.35 * sc;
  const map = (x: number, y: number, z: number): [number, number, number] => {
    const dx = x - cx,
      dy = y - cy;
    const rx = dx * cs - dy * sn + cx;
    const ry = dx * sn + dy * cs + cy;
    return [ox + rx * scX, oy + (plateH - ry) * scY - z * lift, z];
  };
  const faces: Array<{ z: number; pts: number[]; shade: number }> = [];
  const step = Math.max(1, Math.floor(tris.length / 8000));
  for (let i = 0; i < tris.length; i += step) {
    const t = tris[i];
    const a = map(t[0], t[1], t[2]);
    const b = map(t[3], t[4], t[5]);
    const c = map(t[6], t[7], t[8]);
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
    const shade = 0.32 + 0.68 * Math.max(0, nx * 0.15 + ny * 0.1 + nz * 0.95);
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

const DEFAULT_VIEW = { zoom: 1, panx: 0, pany: 0, az: 0, ax: -1.35 };

export function Preview({
  result,
  mode,
  showNum,
  jigColor,
  resetToken,
  onMove,
}: {
  result: JigResult | null;
  mode: PreviewMode;
  showNum: boolean;
  jigColor: string;
  resetToken: number;
  onMove: (label: string, dx: number, dy: number) => void;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const miniImg = useRef<HTMLImageElement | null>(null);
  const stdImg = useRef<HTMLImageElement | null>(null);
  const view = useRef({ ...DEFAULT_VIEW });
  const drag = useRef<{ kind: "pan" | "orbit" | "piece" | null; x: number; y: number; label?: string }>({
    kind: null,
    x: 0,
    y: 0,
  });
  const latest = useRef({ result, mode, showNum, jigColor, onMove });
  latest.current = { result, mode, showNum, jigColor, onMove };

  const paintRef = useRef<() => void>(() => {});

  useEffect(() => {
    const load = (src: string, slot: { current: HTMLImageElement | null }) => {
      const img = new Image();
      img.decoding = "async";
      img.onload = () => {
        slot.current = img;
        paintRef.current();
      };
      img.src = src;
    };
    load(bedMiniUrl, miniImg);
    load(bedStdUrl, stdImg);
  }, []);

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
      const plate = result ? viewSize(result, mode) : { w: 333, h: 88 };
      const tmpl = templateForResult(result);
      const bedImg = tmpl.file === BED_STD.file ? stdImg.current : miniImg.current;
      const bv = fitBedView(W, H, plate.w, plate.h, view.current.zoom, view.current.panx, view.current.pany, tmpl);
      drawBedBackground(ctx, bedImg, bv);
      if (!result) {
        ctx.fillStyle = "#8b9aab";
        ctx.font = "14px sans-serif";
        ctx.fillText("Añade un objeto para previsualizar", 24, 36);
        return;
      }
      if (mode === "jig3d") {
        drawMeshOnPlate(ctx, result, bv, plate.h, view.current.az, view.current.ax, jigColor);
        return;
      }
      if (mode === "template") {
        drawSilhouettes(ctx, result, bv, plate.h, showNum);
        return;
      }
      const ents = mode === "laserBase" ? result.laser.baseEntities : result.laser.pocketEntities;
      drawEntities(ctx, ents, bv.ox, bv.oy, (bv.scX + bv.scY) / 2, plate.h, showNum);
    };
    paintRef.current = paint;

    const ro = new ResizeObserver(() => paint());
    ro.observe(parent);

    const currentView = () => {
      const { result, mode } = latest.current;
      const rect = canvas.getBoundingClientRect();
      const plate = result ? viewSize(result, mode) : { w: 333, h: 88 };
      return {
        plate,
        bv: fitBedView(rect.width, rect.height, plate.w, plate.h, view.current.zoom, view.current.panx, view.current.pany, templateForResult(result)),
      };
    };

    const hitLabel = (ev: PointerEvent) => {
      const { result, mode } = latest.current;
      if (!result || mode !== "template") return null;
      const rect = canvas.getBoundingClientRect();
      const { plate, bv } = currentView();
      const px = (ev.clientX - rect.left - bv.ox) / bv.scX;
      const py = plate.h - (ev.clientY - rect.top - bv.oy) / bv.scY;
      const [x, y] = plateToBed(result, px, py);
      for (let i = result.placed.length - 1; i >= 0; i--) {
        const p = result.placed[i];
        if (x >= p.x && x <= p.x + p.w && y >= p.y && y <= p.y + p.h) return p.label;
      }
      return null;
    };

    const down = (ev: PointerEvent) => {
      canvas.setPointerCapture(ev.pointerId);
      if (latest.current.mode === "jig3d" && ev.shiftKey) {
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
        const { bv } = currentView();
        latest.current.onMove(
          drag.current.label,
          (ev.clientX - drag.current.x) / bv.scX,
          -(ev.clientY - drag.current.y) / bv.scY,
        );
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

  useEffect(() => {
    view.current = { ...DEFAULT_VIEW };
    paintRef.current();
  }, [resetToken]);

  return <canvas ref={ref} />;
}
