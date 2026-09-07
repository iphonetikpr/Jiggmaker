import { LAYER_SVG } from "../constants";
import type { Entity } from "../types";

export function renderTemplatePng(
  canvas: HTMLCanvasElement,
  bedW: number,
  bedH: number,
  entities: Entity[],
  dpi: number,
  showNum: boolean,
): Promise<Blob> {
  const px = (mm: number) => (mm / 25.4) * dpi;
  const w = Math.max(1, Math.round(px(bedW)));
  const h = Math.max(1, Math.round(px(bedH)));
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return Promise.reject(new Error("canvas"));
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, w, h);
  const sx = (x: number) => px(x);
  const sy = (y: number) => px(bedH - y);
  for (const e of entities) {
    const color = e.color || LAYER_SVG[(e.layer || "").toUpperCase()] || "#000";
    if (e.type === "circle" && e.cx != null && e.cy != null && e.r != null) {
      ctx.beginPath();
      ctx.arc(sx(e.cx), sy(e.cy), px(e.r), 0, Math.PI * 2);
      ctx.strokeStyle = color;
      ctx.lineWidth = Math.max(1, px(e.strokeWidth || 0.2));
      ctx.stroke();
      continue;
    }
    if (e.type === "text") {
      if (!showNum && e.layer === "TEXT") continue;
      ctx.fillStyle = color;
      ctx.font = `${Math.max(10, px(e.size || 4))}px sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(e.text || "", sx(e.x || 0), sy(e.y || 0));
      continue;
    }
    const pts = e.points;
    if (!pts || !pts.length) continue;
    ctx.beginPath();
    ctx.moveTo(sx(pts[0][0]), sy(pts[0][1]));
    for (let i = 1; i < pts.length; i++) ctx.lineTo(sx(pts[i][0]), sy(pts[i][1]));
    if (e.closed) ctx.closePath();
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(1, px(e.strokeWidth || 0.2));
    ctx.stroke();
  }
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("png"))), "image/png");
  });
}
