import { useEffect, useRef } from "react";
import { LAYER_SVG } from "../constants";
import type { Entity, JigResult, PreviewMode } from "../types";
import bedMiniSvg from "../assets/bed-mini.svg?raw";
import bedStdSvg from "../assets/bed-std.svg?raw";
import { piecePose } from "../cad/pose";
import { jigOrbitCamera } from "./partView";
import {
  JIG_MESH_BG,
  drawViewCube,
  hexToRgb,
  hitViewCubeFace,
  jigHudCaption,
  jigPreviewSample,
  renderJigMesh,
  shortestAzDelta,
  viewCubeLayout,
  type ViewCubeLayout,
} from "./jigRender";
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

function blitFrame(ctx: CanvasRenderingContext2D, off: HTMLCanvasElement, data: Uint8ClampedArray, srcW: number, srcH: number, destW: number, destH: number) {
  off.width = srcW;
  off.height = srcH;
  const octx = off.getContext("2d");
  if (!octx) return;
  const img = octx.createImageData(srcW, srcH);
  img.data.set(data);
  octx.putImageData(img, 0, 0);
  ctx.imageSmoothingEnabled = true;
  if ("imageSmoothingQuality" in ctx) ctx.imageSmoothingQuality = "high";
  ctx.drawImage(off, 0, 0, destW, destH);
}

/** Orbit the plate + pockets solid. Uniform scale (scX === scY); not the bed 333×88 mapping. */
function drawMesh(
  ctx: CanvasRenderingContext2D,
  off: HTMLCanvasElement,
  result: JigResult,
  W: number,
  H: number,
  az: number,
  ax: number,
  zoom: number,
  color: string,
  dpr: number,
  dragging: boolean,
): ViewCubeLayout {
  ctx.fillStyle = "#202024";
  ctx.fillRect(0, 0, W, H);
  const tris = result.mesh;
  if (!tris.length) {
    ctx.fillStyle = "#8a8a92";
    ctx.font = "13px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("Añade un objeto para previsualizar el jig", W / 2, H / 2);
    return viewCubeLayout(W, H, az, ax);
  }
  const sample = jigPreviewSample(W, H, dpr, dragging);
  const cam = jigOrbitCamera(result.jig.w, result.jig.h, result.solidH, tris, sample.w, sample.h, zoom);
  const frame = renderJigMesh(tris, cam, az, ax, sample.w, sample.h, hexToRgb(color), JIG_MESH_BG);
  blitFrame(ctx, off, frame.data, frame.w, frame.h, W, H);
  const cube = viewCubeLayout(W, H, az, ax);
  drawViewCube(ctx, cube);
  ctx.fillStyle = "#b9b9c2";
  ctx.font = "11px sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillText(jigHudCaption(tris.length, result.jig.w, result.jig.h, result.solidH), 12, H - 12);
  return cube;
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
  const offscreen = useRef<HTMLCanvasElement | null>(null);
  const view2 = useRef({ ...DEFAULT_2D });
  const view3 = useRef({ ...DEFAULT_3D });
  const cube = useRef<ViewCubeLayout | null>(null);
  const snap = useRef<number | null>(null);
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
      const parentBox = parent.getBoundingClientRect();
      const box = canvas.getBoundingClientRect();
      const W = Math.max(1, parentBox.width || parent.clientWidth || box.width);
      const H = Math.max(1, parentBox.height || parent.clientHeight || box.height);
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
      canvas.style.width = "";
      canvas.style.height = "";
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
          cube.current = null;
          return;
        }
        if (!offscreen.current) offscreen.current = document.createElement("canvas");
        cube.current = drawMesh(
          ctx,
          offscreen.current,
          result,
          W,
          H,
          view3.current.az,
          view3.current.ax,
          view3.current.zoom,
          jigColor,
          dpr,
          drag.current.kind === "orbit",
        );
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

    const localXy = (ev: PointerEvent) => {
      const { box } = measure();
      return [ev.clientX - box.left, ev.clientY - box.top] as const;
    };

    const setCursor = (ev?: PointerEvent) => {
      if (latest.current.mode === "jig3d") {
        if (drag.current.kind) {
          canvas.style.cursor = "grabbing";
          return;
        }
        if (ev && cube.current) {
          const [x, y] = localXy(ev);
          if (hitViewCubeFace(cube.current, x, y)) {
            canvas.style.cursor = "pointer";
            return;
          }
        }
        canvas.style.cursor = "grab";
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

    const snapTo = (ax: number, az: number) => {
      if (snap.current != null) cancelAnimationFrame(snap.current);
      const fromAx = view3.current.ax;
      const fromAz = view3.current.az;
      const dAz = shortestAzDelta(fromAz, az);
      const t0 = performance.now();
      const step = (now: number) => {
        const t = Math.min(1, (now - t0) / 280);
        const s = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
        view3.current.ax = fromAx + (ax - fromAx) * s;
        view3.current.az = fromAz + dAz * s;
        paint();
        if (t < 1) snap.current = requestAnimationFrame(step);
        else snap.current = null;
      };
      snap.current = requestAnimationFrame(step);
    };

    const down = (ev: PointerEvent) => {
      if (latest.current.mode === "jig3d") {
        const [x, y] = localXy(ev);
        const face = cube.current ? hitViewCubeFace(cube.current, x, y) : null;
        if (face) {
          snapTo(face.view.ax, face.view.az);
          return;
        }
        canvas.setPointerCapture(ev.pointerId);
        drag.current = { kind: "orbit", x: ev.clientX, y: ev.clientY };
        setCursor();
        return;
      }
      canvas.setPointerCapture(ev.pointerId);
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
      const wasOrbit = drag.current.kind === "orbit";
      drag.current.kind = null;
      setCursor();
      if (wasOrbit) paint();
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
      if (snap.current != null) cancelAnimationFrame(snap.current);
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
    if (snap.current != null) cancelAnimationFrame(snap.current);
    snap.current = null;
    view2.current = { ...DEFAULT_2D };
    view3.current = { ...DEFAULT_3D };
    paintRef.current();
  }, [resetToken]);

  return <canvas ref={ref} />;
}
