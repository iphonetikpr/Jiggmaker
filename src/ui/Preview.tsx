import { useEffect, useRef } from "react";
import { LAYER_SVG } from "../constants";
import type { Entity, JigResult, PreviewMode } from "../types";
import bedMiniSvg from "../assets/bed-mini.svg?raw";
import bedStdSvg from "../assets/bed-std.svg?raw";
import { piecePose, toMeshPoint } from "../cad/pose";
import { orbitProject } from "./partView";
import {
  type BedView,
  BED_STD,
  clientToBedMm,
  fitBedView,
  fitTemplateView,
  plantillaMarkup,
  plateViewSize,
  pocketLoopsOf,
  silhouetteLoopsOf,
  templateForResult,
} from "./bedPreview";
import { hitPieceLabel } from "./previewHit";

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

function strokeLoop(
  ctx: CanvasRenderingContext2D,
  loop: [number, number][],
  X: (x: number) => number,
  Y: (y: number) => number,
) {
  if (loop.length < 2) return false;
  ctx.beginPath();
  ctx.moveTo(X(loop[0][0]), Y(loop[0][1]));
  for (let i = 1; i < loop.length; i++) ctx.lineTo(X(loop[i][0]), Y(loop[i][1]));
  ctx.closePath();
  return true;
}

function drawSilhouettes(
  ctx: CanvasRenderingContext2D,
  result: JigResult,
  ox: number,
  oy: number,
  sc: number,
  bedH: number,
  showNum: boolean,
) {
  const X = (x: number) => ox + x * sc;
  const Y = (y: number) => oy + (bedH - y) * sc;
  for (const p of result.placed) {
    const pose = piecePose(p);
    for (const loop of pocketLoopsOf(p)) {
      if (!strokeLoop(ctx, loop, X, Y)) continue;
      ctx.fillStyle = rgba(p.color, 0.22);
      ctx.fill();
      ctx.strokeStyle = LAYER_SVG.CUT;
      ctx.lineWidth = Math.max(1.75, 0.4 * sc);
      ctx.stroke();
    }
    if (pose.art !== pose.pocket) {
      for (const loop of silhouetteLoopsOf(p)) {
        if (!strokeLoop(ctx, loop, X, Y)) continue;
        ctx.fillStyle = rgba(p.color, 0.16);
        ctx.fill();
        ctx.strokeStyle = p.color;
        ctx.lineWidth = Math.max(1.1, 0.22 * sc);
        ctx.stroke();
      }
    }
    for (const loop of pose.holes) {
      if (!strokeLoop(ctx, loop, X, Y)) continue;
      ctx.strokeStyle = LAYER_SVG.SCORE;
      ctx.lineWidth = Math.max(1.25, 0.25 * sc);
      ctx.stroke();
    }
    if (showNum) {
      ctx.fillStyle = p.color;
      ctx.font = `600 ${Math.max(11, 4.5 * sc)}px sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(p.label, X(p.cx), Y(p.cy));
    }
  }
}

function drawBedBackground(ctx: CanvasRenderingContext2D, img: HTMLImageElement | null, dest: { imgX: number; imgY: number; imgW: number; imgH: number }) {
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(dest.imgX, dest.imgY, dest.imgW, dest.imgH);
  if (img && img.complete && img.naturalWidth > 0) {
    ctx.drawImage(img, dest.imgX, dest.imgY, dest.imgW, dest.imgH);
  }
}

function hex(c: string): [number, number, number] {
  const n = c.replace("#", "");
  return [parseInt(n.slice(0, 2), 16), parseInt(n.slice(2, 4), 16), parseInt(n.slice(4, 6), 16)];
}

/** Orbit the plate + pockets solid (jiggenerator 3D jig tab). One matrix for mesh + rims. */
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
  ctx.fillStyle = "#202024";
  ctx.fillRect(0, 0, W, H);
  if (!tris.length) {
    ctx.fillStyle = "#8a8a92";
    ctx.font = "13px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("Añade un objeto para previsualizar el jig", W / 2, H / 2);
    return;
  }
  const cx = result.jig.w / 2,
    cy = result.jig.h / 2,
    cz = result.solidH / 2;
  let maxR = 1;
  for (const t of tris) {
    for (let i = 0; i < 9; i += 3) {
      maxR = Math.max(maxR, Math.hypot(t[i] - cx, t[i + 1] - cy, t[i + 2] - cz));
    }
  }
  const sc = (0.42 * Math.min(W, H) * zoom) / maxR;
  const project = (x: number, y: number, z: number) => orbitProject(x, y, z, cx, cy, cz, az, ax, sc, W, H);
  const faces: Array<{ z: number; pts: number[]; shade: number }> = [];
  for (let i = 0; i < tris.length; i++) {
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
    const zAvg = (t[2] + t[5] + t[8]) / 3;
    const recessed = zAvg < result.solidH * result.meshXform.s - 0.2 ? 0.58 : 1;
    const shade = (0.35 + 0.65 * Math.max(0, nx * 0.3 + ny * 0.15 + nz * 0.9)) * recessed;
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
  drawPocketRims(ctx, result, project);
}

function drawPocketRims(
  ctx: CanvasRenderingContext2D,
  result: JigResult,
  project: (x: number, y: number, z: number) => [number, number, number],
) {
  const topZ = result.solidH;
  const offset = result.plateOffset;
  const xf = result.meshXform;
  ctx.lineJoin = "round";
  ctx.lineWidth = 1.6;
  ctx.strokeStyle = "rgba(255,255,255,0.88)";
  for (const p of result.placed) {
    for (const loop of pocketLoopsOf(p)) {
      if (loop.length < 2) continue;
      ctx.beginPath();
      for (let i = 0; i < loop.length; i++) {
        const [mx, my, mz] = toMeshPoint(loop[i][0], loop[i][1], topZ, offset, xf);
        const [sx, sy] = project(mx, my, mz);
        if (i === 0) ctx.moveTo(sx, sy);
        else ctx.lineTo(sx, sy);
      }
      ctx.closePath();
      ctx.stroke();
    }
  }
}

const DEFAULT_2D = { zoom: 1, panx: 0, pany: 0 };
const DEFAULT_3D = { zoom: 1, az: 0.62, ax: -0.65 };

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
  const view2 = useRef({ ...DEFAULT_2D });
  const view3 = useRef({ ...DEFAULT_3D });
  const drag = useRef<{ kind: "pan" | "orbit" | "piece" | null; x: number; y: number; label?: string }>({
    kind: null,
    x: 0,
    y: 0,
  });
  const latest = useRef({ result, mode, showNum, jigColor, onMove });
  latest.current = { result, mode, showNum, jigColor, onMove };

  const paintRef = useRef<() => void>(() => {});

  useEffect(() => {
    const urls: string[] = [];
    const load = (markup: string, slot: { current: HTMLImageElement | null }) => {
      const img = new Image();
      img.decoding = "async";
      const url = URL.createObjectURL(new Blob([plantillaMarkup(markup)], { type: "image/svg+xml" }));
      urls.push(url);
      img.onload = () => {
        slot.current = img;
        paintRef.current();
      };
      img.src = url;
    };
    load(bedMiniSvg, miniImg);
    load(bedStdSvg, stdImg);
    return () => {
      for (const url of urls) URL.revokeObjectURL(url);
    };
  }, []);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const parent = canvas.parentElement!;

    const measure = () => {
      const box = canvas.getBoundingClientRect();
      const W = Math.max(1, box.width || parent.clientWidth);
      const H = Math.max(1, box.height || parent.clientHeight);
      return { box, W, H };
    };

    const templateView = (W: number, H: number, result: JigResult | null) => {
      const bed = result?.template.bed ?? { w: 333, h: 88 };
      return {
        bed,
        tv: fitTemplateView(W, H, bed.w, bed.h, view2.current.zoom, view2.current.panx, view2.current.pany, templateForResult(result)),
      };
    };

    const laserView = (W: number, H: number, result: JigResult): BedView => {
      const plate = plateViewSize(result);
      return fitBedView(W, H, plate.w, plate.h, view2.current.zoom, view2.current.panx, view2.current.pany, templateForResult(result));
    };

    const paint = () => {
      const { result, mode, showNum, jigColor } = latest.current;
      const dpr = window.devicePixelRatio || 1;
      const { W, H } = measure();
      canvas.width = Math.max(1, Math.round(W * dpr));
      canvas.height = Math.max(1, Math.round(H * dpr));
      canvas.style.width = W + "px";
      canvas.style.height = H + "px";
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      if (mode === "jig3d") {
        if (!result) {
          ctx.fillStyle = "#202024";
          ctx.fillRect(0, 0, W, H);
          ctx.fillStyle = "#8a8a92";
          ctx.font = "13px sans-serif";
          ctx.fillText("Añade un objeto para previsualizar el jig", 24, 36);
          return;
        }
        drawMesh(ctx, result, W, H, view3.current.az, view3.current.ax, view3.current.zoom, jigColor);
        return;
      }
      const tmpl = templateForResult(result);
      const bedImg = tmpl.file === BED_STD.file ? stdImg.current : miniImg.current;
      if (mode === "template") {
        const { bed, tv } = templateView(W, H, result);
        drawBedBackground(ctx, bedImg, tv);
        if (!result) {
          ctx.fillStyle = "#8b9aab";
          ctx.font = "14px sans-serif";
          ctx.fillText("Añade un objeto para previsualizar", 24, 36);
          return;
        }
        drawSilhouettes(ctx, result, tv.ox, tv.oy, tv.sc, bed.h, showNum);
        return;
      }
      if (!result) {
        ctx.fillStyle = "#8b9aab";
        ctx.font = "14px sans-serif";
        ctx.fillText("Añade un objeto para previsualizar", 24, 36);
        return;
      }
      const plate = plateViewSize(result);
      const bv = laserView(W, H, result);
      drawBedBackground(ctx, bedImg, bv);
      const ents = mode === "laserBase" ? result.laser.baseEntities : result.laser.pocketEntities;
      drawEntities(ctx, ents, bv.ox, bv.oy, (bv.scX + bv.scY) / 2, plate.h, showNum);
    };
    paintRef.current = paint;

    const ro = new ResizeObserver(() => paint());
    ro.observe(parent);

    const worldFromEvent = (ev: PointerEvent) => {
      const { result } = latest.current;
      if (!result) return null;
      const { box, W, H } = measure();
      const { bed, tv } = templateView(W, H, result);
      return { bed, tv, box, xy: clientToBedMm(ev.clientX, ev.clientY, box.left, box.top, tv, bed.h) };
    };

    const hitLabel = (ev: PointerEvent) => {
      const { result, mode } = latest.current;
      if (!result || mode !== "template") return null;
      const world = worldFromEvent(ev);
      if (!world) return null;
      return hitPieceLabel(result.placed, world.xy[0], world.xy[1]);
    };

    const setCursor = (ev?: PointerEvent) => {
      if (latest.current.mode === "jig3d") {
        canvas.style.cursor = drag.current.kind ? "grabbing" : "grab";
        return;
      }
      if (drag.current.kind) {
        canvas.style.cursor = "grabbing";
        return;
      }
      if (ev && latest.current.mode === "template" && hitLabel(ev)) {
        canvas.style.cursor = "grab";
        return;
      }
      canvas.style.cursor = view2.current.zoom > 1.01 ? "grab" : "default";
    };

    const down = (ev: PointerEvent) => {
      canvas.setPointerCapture(ev.pointerId);
      if (latest.current.mode === "jig3d") {
        drag.current = { kind: "orbit", x: ev.clientX, y: ev.clientY };
        setCursor();
        return;
      }
      const label = hitLabel(ev);
      drag.current = label
        ? { kind: "piece", x: ev.clientX, y: ev.clientY, label }
        : { kind: "pan", x: ev.clientX, y: ev.clientY };
      setCursor();
    };
    const move = (ev: PointerEvent) => {
      if (!drag.current.kind) {
        setCursor(ev);
        return;
      }
      if (drag.current.kind === "orbit") {
        view3.current.az += (ev.clientX - drag.current.x) * 0.01;
        view3.current.ax = Math.max(-3.12, Math.min(-0.02, view3.current.ax - (ev.clientY - drag.current.y) * 0.01));
        drag.current.x = ev.clientX;
        drag.current.y = ev.clientY;
        paint();
        return;
      }
      if (drag.current.kind === "pan") {
        view2.current.panx += ev.clientX - drag.current.x;
        view2.current.pany += ev.clientY - drag.current.y;
        drag.current.x = ev.clientX;
        drag.current.y = ev.clientY;
        paint();
        return;
      }
      if (drag.current.kind === "piece" && drag.current.label) {
        const world = worldFromEvent(ev);
        const sc = world?.tv.sc || 1;
        latest.current.onMove(drag.current.label, (ev.clientX - drag.current.x) / sc, -(ev.clientY - drag.current.y) / sc);
        drag.current.x = ev.clientX;
        drag.current.y = ev.clientY;
      }
    };
    const up = () => {
      drag.current.kind = null;
      setCursor();
    };
    const wheel = (ev: WheelEvent) => {
      ev.preventDefault();
      if (latest.current.mode === "jig3d") {
        view3.current.zoom = Math.max(0.3, Math.min(8, view3.current.zoom * Math.exp(-ev.deltaY * 0.0015)));
      } else {
        view2.current.zoom = Math.max(0.4, Math.min(12, view2.current.zoom * Math.exp(-ev.deltaY * 0.0015)));
      }
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
    view2.current = { ...DEFAULT_2D };
    view3.current = { ...DEFAULT_3D };
    paintRef.current();
  }, [resetToken]);

  return <canvas ref={ref} />;
}
