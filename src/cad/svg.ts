import { LAYER_SVG } from "../constants";
import type { Entity } from "../types";
import { round3 } from "./geom";

function pathD(pts: Array<[number, number]>, height: number, closed?: boolean): string {
  let d = "";
  for (let i = 0; i < pts.length; i++) {
    d += `${i === 0 ? "M" : "L"}${round3(pts[i][0])} ${round3(height - pts[i][1])} `;
  }
  if (closed) d += "Z";
  return d.trim();
}

function esc(s: string): string {
  return String(s).replace(/[<>&'"]/g, (c) =>
    ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[c] || c,
  );
}

export function toSVG(
  w: number,
  h: number,
  entities: Entity[],
  opts?: { background?: string },
): string {
  const bg = opts?.background || "none";
  let o = `<?xml version="1.0" encoding="UTF-8"?>\n`;
  o += `<svg xmlns="http://www.w3.org/2000/svg" width="${round3(w)}mm" height="${round3(h)}mm" viewBox="0 0 ${round3(w)} ${round3(h)}">\n`;
  if (bg !== "none") {
    o += `<rect x="0" y="0" width="${round3(w)}" height="${round3(h)}" fill="${bg}"/>\n`;
  }
  for (const e of entities) {
    const color = e.color || LAYER_SVG[(e.layer || "").toUpperCase()] || "#000000";
    const sw = e.strokeWidth != null ? e.strokeWidth : 0.1;
    if (e.type === "circle" && e.cx != null && e.cy != null && e.r != null) {
      o += `<circle cx="${round3(e.cx)}" cy="${round3(h - e.cy)}" r="${round3(e.r)}" fill="none" stroke="${color}" stroke-width="${sw}"/>\n`;
      continue;
    }
    if (e.type === "text" && e.text != null && e.x != null && e.y != null) {
      o += `<text x="${round3(e.x)}" y="${round3(h - e.y)}" font-size="${e.size || 4}" fill="${color}" text-anchor="middle" font-family="sans-serif">${esc(e.text)}</text>\n`;
      continue;
    }
    if (e.rings) {
      let d = "";
      for (const ring of e.rings) d += pathD(ring, h, true) + " ";
      o += `<path d="${d.trim()}" fill="${e.fill || "none"}" fill-rule="evenodd" stroke="${color}" stroke-width="${sw}"/>\n`;
      continue;
    }
    if (e.points) {
      o += `<path d="${pathD(e.points, h, e.closed)}" fill="${e.fill || "none"}" stroke="${color}" stroke-width="${sw}"/>\n`;
    }
  }
  o += `</svg>\n`;
  return o;
}
