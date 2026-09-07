import { useRef } from "react";
import type { JobObject } from "../types";
import { OBJECT_COLORS } from "../constants";

export function ObjectCard({
  obj,
  index,
  canRemove,
  onChange,
  onRemove,
  onStl,
}: {
  obj: JobObject;
  index: number;
  canRemove: boolean;
  onChange: (patch: Partial<JobObject>) => void;
  onRemove: () => void;
  onStl: (file: File) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const color = OBJECT_COLORS[index % OBJECT_COLORS.length];

  return (
    <div className="objcard">
      <div className="objhd">
        <span className="objdot" style={{ background: color }} />
        <b>
          Objeto {String.fromCharCode(65 + index)}
        </b>
        <span className="sp" />
        {canRemove && (
          <button className="ghost" type="button" onClick={onRemove} title="Quitar">
            ✕
          </button>
        )}
      </div>
      <div className="row">
        <input
          type="text"
          value={obj.name}
          placeholder="Nombre"
          onChange={(e) => onChange({ name: e.target.value })}
          style={{ flex: 1, width: "auto" }}
        />
        <span style={{ color: "var(--muted)", fontFamily: "var(--mono)" }}>qty</span>
        <input
          type="number"
          min={1}
          step={1}
          value={obj.count}
          onChange={(e) => onChange({ count: Math.max(1, +e.target.value || 1) })}
        />
      </div>
      <div
        className="drop"
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          e.currentTarget.classList.add("over");
        }}
        onDragLeave={(e) => e.currentTarget.classList.remove("over")}
        onDrop={(e) => {
          e.preventDefault();
          e.currentTarget.classList.remove("over");
          const f = e.dataTransfer.files[0];
          if (f) onStl(f);
        }}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".stl"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onStl(f);
            e.target.value = "";
          }}
        />
        {obj.stlName ? (
          <div>
            <b>{obj.stlName}</b>
            <div>STL cargado · click para reemplazar</div>
          </div>
        ) : (
          <div>
            Suelta <b>.STL</b> o usa rectángulo
          </div>
        )}
      </div>
      <div className="row">
        <label>Ancho × alto mm</label>
        <input
          type="number"
          min={1}
          step={0.1}
          value={obj.rectW}
          onChange={(e) => onChange({ rectW: +e.target.value || 1, mode: obj.stlName ? obj.mode : "rectangle" })}
        />
        <input
          type="number"
          min={1}
          step={0.1}
          value={obj.rectH}
          onChange={(e) => onChange({ rectH: +e.target.value || 1, mode: obj.stlName ? obj.mode : "rectangle" })}
        />
      </div>
      <div className="row">
        <label>Eje up</label>
        <select value={obj.up} onChange={(e) => onChange({ up: e.target.value as JobObject["up"] })}>
          <option value="z+">Z up</option>
          <option value="z-">Z down</option>
          <option value="y+">Y up</option>
          <option value="y-">Y down</option>
          <option value="x+">X up</option>
          <option value="x-">X down</option>
        </select>
      </div>
      <div className="row">
        <label>Rotar</label>
        <div className="seg" style={{ flex: 1.4 }}>
          {[0, 90, 180, 270].map((r) => (
            <button key={r} type="button" className={obj.rot === r ? "on" : ""} onClick={() => onChange({ rot: r })}>
              {r}°
            </button>
          ))}
        </div>
      </div>
      <label className="chk">
        <input type="checkbox" checked={obj.mirror} onChange={(e) => onChange({ mirror: e.target.checked })} />
        Mirror
      </label>
      <label className="chk">
        <input type="checkbox" checked={obj.auto} onChange={(e) => onChange({ auto: e.target.checked })} />
        Auto-rotar (menos desperdicio)
      </label>
      <div className="row">
        <label>Pocket</label>
        <div className="seg" style={{ flex: 1.4 }}>
          <button
            type="button"
            className={obj.mode === "silhouette" ? "on" : ""}
            onClick={() => onChange({ mode: "silhouette" })}
            disabled={!obj.stlName}
          >
            Silueta
          </button>
          <button
            type="button"
            className={obj.mode === "rectangle" ? "on" : ""}
            onClick={() => onChange({ mode: "rectangle" })}
          >
            Rectángulo
          </button>
        </div>
      </div>
      <div className="row">
        <label>Clearance mm</label>
        <input
          type="number"
          min={0}
          max={3}
          step={0.05}
          value={obj.clear}
          onChange={(e) => onChange({ clear: +e.target.value || 0 })}
        />
      </div>
      <div className="row">
        <label>Agujeros pieza</label>
        <select value={obj.holes} onChange={(e) => onChange({ holes: e.target.value as JobObject["holes"] })}>
          <option value="none">Ignorar</option>
          <option value="template">Solo plantilla</option>
          <option value="jig">Solo jig (boss)</option>
          <option value="all">Everywhere</option>
        </select>
      </div>
    </div>
  );
}
