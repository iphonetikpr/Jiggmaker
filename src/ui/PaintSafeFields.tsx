import type { JobSettings } from "../types";
import { NumberField } from "./NumberField";

export function PaintSafeFields({
  settings,
  onChange,
}: {
  settings: JobSettings;
  onChange: (patch: Partial<JobSettings>) => void;
}) {
  return (
    <>
      <label className="chk">
        <input
          type="checkbox"
          checked={settings.paintSafe}
          onChange={(e) => onChange({ paintSafe: e.target.checked })}
        />
        <span>
          Guía paint-safe
          {settings.paintSafe && (
            <span className="pill" style={{ color: "var(--ok)", background: "color-mix(in srgb, var(--ok) 20%, transparent)" }}>
              GUIDE
            </span>
          )}
        </span>
      </label>
      {settings.paintSafe && (
        <>
          <div className="row">
            <label>Modo</label>
            <div className="seg" style={{ flex: 1.4 }}>
              <button
                type="button"
                className={settings.paintSafeMode === "inset" ? "on" : ""}
                onClick={() => onChange({ paintSafeMode: "inset" })}
              >
                Inset
              </button>
              <button
                type="button"
                className={settings.paintSafeMode === "fixed" ? "on" : ""}
                onClick={() => onChange({ paintSafeMode: "fixed" })}
              >
                Fixed
              </button>
            </div>
          </div>
          {settings.paintSafeMode === "inset" ? (
            <div className="row">
              <label>Inset mm / lado</label>
              <NumberField
                min={0}
                step={0.1}
                value={settings.paintSafeInset}
                onChange={(paintSafeInset) => onChange({ paintSafeInset })}
                aria-label="Paint-safe inset mm"
              />
            </div>
          ) : (
            <div className="row">
              <label>W × H mm</label>
              <NumberField
                min={0.5}
                step={0.1}
                value={settings.paintSafeW}
                onChange={(paintSafeW) => onChange({ paintSafeW })}
                aria-label="Paint-safe width mm"
              />
              <NumberField
                min={0.5}
                step={0.1}
                value={settings.paintSafeH}
                onChange={(paintSafeH) => onChange({ paintSafeH })}
                aria-label="Paint-safe height mm"
              />
            </div>
          )}
          <p className="hint">
            Contorno interior en Template SVG / preview (verde discontinuo, capa GUIDE). No corta: láser y STL
            siguen el pocket exterior.
          </p>
        </>
      )}
    </>
  );
}
