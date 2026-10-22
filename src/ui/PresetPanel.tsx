import type { NamedPreset } from "../cad/presets";

type Props = {
  presets: NamedPreset[];
  activeId: string | null;
  dirty: boolean;
  draftName: string;
  projectName: string | null;
  onDraftName: (name: string) => void;
  onSave: () => void;
  onLoad: (id: string) => void;
  onRename: (id: string) => void;
  onDelete: (id: string) => void;
  onExportProject: () => void;
  onImportProject: () => void;
};

export function PresetPanel({
  presets,
  activeId,
  dirty,
  draftName,
  projectName,
  onDraftName,
  onSave,
  onLoad,
  onRename,
  onDelete,
  onExportProject,
  onImportProject,
}: Props) {
  const active = presets.find((p) => p.id === activeId);
  return (
    <section className="card preset-card">
      <h2>Presets</h2>
      <div className="preset-active">
        <span>Activo</span>
        <b>{active?.name ?? "Sin preset"}</b>
        {active && dirty ? <span className="pill warn-pill">modificado</span> : null}
      </div>
      {projectName ? <p className="hint">Proyecto: {projectName}</p> : null}
      <div className="row">
        <input
          type="text"
          placeholder="Nombre del preset"
          aria-label="Nombre del preset"
          value={draftName}
          onChange={(e) => onDraftName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && onSave()}
          style={{ flex: 1, width: "auto" }}
        />
        <button className="btn primary" type="button" onClick={onSave}>
          Save
        </button>
      </div>
      <ul className="preset-list">
        {presets.map((preset) => (
          <li key={preset.id} className={preset.id === activeId ? "on" : ""}>
            <div className="preset-meta">
              <div className="hi-name">{preset.name}</div>
              {preset.readonly ? <div className="hi-date">solo lectura</div> : null}
            </div>
            <button className="btn" type="button" onClick={() => onLoad(preset.id)}>
              Load
            </button>
            {preset.readonly ? null : (
              <>
                <button className="ghost" type="button" onClick={() => onRename(preset.id)}>
                  Renombrar
                </button>
                <button className="ghost" type="button" aria-label={"Borrar " + preset.name} onClick={() => onDelete(preset.id)}>
                  ✕
                </button>
              </>
            )}
          </li>
        ))}
      </ul>
      <div className="row" style={{ gap: 8 }}>
        <button className="btn" type="button" onClick={onExportProject}>
          Export project…
        </button>
        <button className="btn" type="button" onClick={onImportProject}>
          Import project…
        </button>
      </div>
      <p className="hint">
        Presets guardan parámetros (cama, footprint, base, pocket, clearance, Up axis), no la geometría. Un
        .jiggmaker.json lleva el job completo, STL incluido.
      </p>
    </section>
  );
}
