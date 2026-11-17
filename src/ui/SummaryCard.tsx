import type { JigResult } from "../types";
import { formatMm, summaryBedLine, summaryJigSize, summaryObjectMeta, summaryPlateHint, summaryStlCompensated, summaryStlNominal, thinBaseWarning, truncateName } from "./summary";

export function SummaryCard({ result }: { result: JigResult }) {
  const hint = summaryPlateHint(result);
  const baseWarn = thinBaseWarning(result.jig.w, result.jig.h, result.baseThk);
  const compensated = summaryStlCompensated(result);
  const scaleLabel = formatMm(result.meshXform.s, 3);
  return (
    <section className="card summary-card">
      <h2>Summary</h2>
      <div className="sum-top">
        <div>
          <div className="sum-count">{result.totalUnits}</div>
          <div className="sum-pockets">{result.totalUnits === 1 ? "pocket" : "pockets"}</div>
          <div className="sum-bed">{summaryBedLine(result)}</div>
          <div className="sum-bed">STL nominal {summaryStlNominal(result)}</div>
          {compensated ? <div className="sum-bed">STL ×{scaleLabel} {compensated}</div> : null}
        </div>
        <div className="sum-pills">
          <span className={result.blockers.length ? "pill warn-pill" : "pill ok-pill"}>
            {result.blockers.length ? "No se puede exportar" : result.fits ? "fits" : "no cabe"}
          </span>
        </div>
      </div>
      <div className="sum-objs">
        {result.objects.map((o) => (
          <div className="sum-obj" key={o.letter}>
            <span className="objdot" style={{ background: o.color }} />
            <span className="sum-obj-name">
              {o.letter} {truncateName(o.name)}
            </span>
            <span className="sum-obj-meta">{summaryObjectMeta(o.placed, o.nominalW, o.nominalH, o.w, o.h)}</span>
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
          <span>STL nominal</span>
          <b>{summaryStlNominal(result)}</b>
        </div>
        {compensated ? (
          <div>
            <span>STL ×{scaleLabel}</span>
            <b>{compensated}</b>
          </div>
        ) : null}
        <div>
          <span>Jig mesh</span>
          <b>{result.mesh.length} triangles</b>
        </div>
      </div>
      {baseWarn ? <p className="notice-msg thin-base-warn">{baseWarn}</p> : null}
    </section>
  );
}
