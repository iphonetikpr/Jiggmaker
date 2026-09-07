import type { JigResult } from "../types";
import { summaryBedLine, summaryJigSize, summaryPlateHint, truncateName } from "./summary";

export function SummaryCard({ result }: { result: JigResult }) {
  const hint = summaryPlateHint(result);
  return (
    <section className="card summary-card">
      <h2>Summary</h2>
      <div className="sum-top">
        <div>
          <div className="sum-count">{result.totalUnits}</div>
          <div className="sum-pockets">{result.totalUnits === 1 ? "pocket" : "pockets"}</div>
          <div className="sum-bed">{summaryBedLine(result)}</div>
        </div>
        <span className={result.fits ? "pill ok-pill" : "pill warn-pill"}>{result.fits ? "fits" : "no cabe"}</span>
      </div>
      <div className="sum-objs">
        {result.objects.map((o) => (
          <div className="sum-obj" key={o.letter}>
            <span className="objdot" style={{ background: o.color }} />
            <span className="sum-obj-name">
              {o.letter} {truncateName(o.name)}
            </span>
            <span className="sum-obj-meta">
              ×{o.placed} · {o.w.toFixed(0)}×{o.h.toFixed(0)} mm
            </span>
          </div>
        ))}
      </div>
      <div className="sum-details">
        <div>
          <span>Jig size</span>
          <b>
            {summaryJigSize(result)}
            {hint ? ` · ${hint}` : ""}
          </b>
        </div>
        <div>
          <span>Tallest part</span>
          <b>{result.partHeight.toFixed(1)} mm</b>
        </div>
        <div>
          <span>Jig mesh</span>
          <b>{result.mesh.length} triangles</b>
        </div>
      </div>
    </section>
  );
}
