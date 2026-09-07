import { LAYER_ACI } from "../constants";
import type { Entity } from "../types";
import { round3 } from "./geom";

export function toDXF(entities: Entity[]): string {
  const layers = new Map<string, number>();
  for (const e of entities) {
    const name = (e.layer || "0").toUpperCase();
    layers.set(name, LAYER_ACI[name] ?? 7);
  }
  let t = "0\nSECTION\n2\nHEADER\n9\n$INSUNITS\n70\n4\n0\nENDSEC\n";
  t += "0\nSECTION\n2\nTABLES\n0\nTABLE\n2\nLAYER\n";
  for (const [name, aci] of layers) {
    t += `0\nLAYER\n2\n${name}\n70\n0\n62\n${aci}\n6\nCONTINUOUS\n`;
  }
  t += "0\nENDTAB\n0\nENDSEC\n0\nSECTION\n2\nENTITIES\n";
  for (const e of entities) {
    const layer = (e.layer || "0").toUpperCase();
    if (e.type === "circle" && e.cx != null && e.cy != null && e.r != null) {
      t += `0\nCIRCLE\n8\n${layer}\n10\n${round3(e.cx)}\n20\n${round3(e.cy)}\n30\n0\n40\n${round3(e.r)}\n`;
      continue;
    }
    if (e.type === "text") continue;
    const pts = e.points;
    if (!pts || pts.length < 2) continue;
    const closed = e.closed ? 1 : 0;
    t += `0\nPOLYLINE\n8\n${layer}\n66\n1\n70\n${closed}\n`;
    for (const p of pts) {
      t += `0\nVERTEX\n8\n${layer}\n10\n${round3(p[0])}\n20\n${round3(p[1])}\n30\n0\n`;
    }
    if (closed) {
      t += `0\nVERTEX\n8\n${layer}\n10\n${round3(pts[0][0])}\n20\n${round3(pts[0][1])}\n30\n0\n`;
    }
    t += "0\nSEQEND\n";
  }
  t += "0\nENDSEC\n0\nEOF\n";
  return t;
}
