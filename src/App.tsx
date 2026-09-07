import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DEFAULTS, HISTORY_FILENAME, HISTORY_KEY, MAX_OBJECTS } from "./constants";
import { generateJig } from "./cad/generate";
import {
  applyHistorySettings,
  b64ToBytes,
  defaultSettings,
  loadHistory,
  mergeImported,
  newObject,
  saveHistory,
  serializeJob,
} from "./cad/history";
import {
  baseName,
  contoursSvg,
  downloadBytes,
  laserFiles,
  stlFiles,
  templatePngName,
  templateSvg,
} from "./cad/export";
import { renderTemplatePng } from "./cad/png";
import { parseSTL } from "./cad/stl";
import type { HistoryJob, JobObject, JobSettings, PreviewMode, StepId } from "./types";
import { ObjectCard } from "./ui/ObjectCard";
import { PartViewport } from "./ui/PartViewport";
import { Preview } from "./ui/Preview";
import { SummaryCard } from "./ui/SummaryCard";

export default function App() {
  const [step, setStep] = useState<StepId>("setup");
  const [settings, setSettings] = useState<JobSettings>(defaultSettings);
  const [objects, setObjects] = useState<JobObject[]>(() => [newObject(0)]);
  const [stlMap, setStlMap] = useState<Record<string, ArrayBuffer | null>>({});
  const [moves, setMoves] = useState<Record<string, [number, number]>>({});
  const [preview, setPreview] = useState<PreviewMode>("template");
  const [jigColor, setJigColor] = useState("#3ddc97");
  const [viewReset, setViewReset] = useState(0);
  const [help, setHelp] = useState(false);
  const [histName, setHistName] = useState("");
  const [history, setHistory] = useState<HistoryJob[]>([]);
  const pngCanvas = useRef<HTMLCanvasElement>(null);
  const importRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setHistory(loadHistory());
  }, []);

  const patchSettings = (p: Partial<JobSettings>) => setSettings((s) => ({ ...s, ...p }));

  const result = useMemo(() => generateJig(objects, stlMap, settings, moves), [objects, settings, moves, stlMap]);

  const stem = baseName(result, objects[0]?.name || "jig");

  const onStl = async (id: string, file: File) => {
    const buf = await file.arrayBuffer();
    try {
      parseSTL(buf);
    } catch (e) {
      alert("STL inválido: " + ((e as Error).message || e));
      return;
    }
    setStlMap((m) => ({ ...m, [id]: buf }));
    setObjects((list) =>
      list.map((o) =>
        o.id === id
          ? { ...o, stlName: file.name.replace(/\.stl$/i, ""), name: o.name || file.name.replace(/\.stl$/i, "").slice(0, 24), mode: "silhouette" }
          : o,
      ),
    );
  };

  const onMove = useCallback((label: string, dx: number, dy: number) => {
    setMoves((m) => {
      const prev = m[label] || [0, 0];
      return { ...m, [label]: [prev[0] + dx, prev[1] + dy] };
    });
  }, []);

  const saveJob = () => {
    const name =
      histName.trim() ||
      objects[0]?.name ||
      objects[0]?.stlName ||
      "Job " + new Date().toLocaleDateString();
    const job = serializeJob(name, settings, objects, stlMap, moves);
    const next = [job, ...loadHistory()];
    if (!saveHistory(next)) {
      alert("No se pudo guardar (localStorage lleno). Exporta a JSON.");
      return;
    }
    setHistory(next);
    setHistName("");
  };

  const loadJob = (job: HistoryJob) => {
    setSettings(applyHistorySettings(job.settings || {}));
    const objs: JobObject[] = [];
    const nextStl: Record<string, ArrayBuffer | null> = {};
    (job.objects || []).slice(0, MAX_OBJECTS).forEach((raw, i) => {
      const o = newObject(i);
      o.name = raw.name || "";
      o.count = raw.count || 1;
      o.up = (raw.up as JobObject["up"]) || "z+";
      o.rot = raw.rot || 0;
      o.mirror = !!raw.mirror;
      o.auto = !!raw.auto;
      o.mode = raw.mode === "rectangle" ? "rectangle" : "silhouette";
      o.clear = raw.clear ?? DEFAULTS.clearance;
      o.holes = (raw.holes as JobObject["holes"]) || "none";
      o.stlName = raw.stlName || null;
      o.rectW = raw.rectW ?? DEFAULTS.rectW;
      o.rectH = raw.rectH ?? DEFAULTS.rectH;
      if (raw.stl) {
        try {
          const buf = b64ToBytes(raw.stl);
          parseSTL(buf);
          nextStl[o.id] = buf;
          o.stl = raw.stl;
        } catch {
          o.stlName = null;
        }
      }
      if (!raw.stl) o.mode = "rectangle";
      objs.push(o);
    });
    setStlMap(nextStl);
    setObjects(objs.length ? objs : [newObject(0)]);
    setMoves(job.moves && typeof job.moves === "object" ? { ...job.moves } : {});
    setStep("setup");
  };

  const exportHistory = () => {
    const jobs = loadHistory();
    if (!jobs.length) {
      alert("No hay jobs guardados.");
      return;
    }
    downloadBytes(HISTORY_FILENAME, JSON.stringify(jobs), "application/json");
  };

  const importHistory = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result));
        const { jobs, added } = mergeImported(loadHistory(), parsed);
        saveHistory(jobs);
        setHistory(jobs);
        alert("Importados " + added + " job" + (added === 1 ? "" : "s") + ".");
      } catch (e) {
        alert("No se pudo leer el archivo: " + ((e as Error).message || e));
      }
    };
    reader.readAsText(file);
  };

  const downloadPng = async () => {
    const c = pngCanvas.current;
    if (!c) return;
    const blob = await renderTemplatePng(
      c,
      result.template.bed.w,
      result.template.bed.h,
      result.template.entities,
      settings.dpi,
      settings.showNum,
    );
    downloadBytes(templatePngName(stem, settings.dpi), blob, "image/png");
  };

  const mini = settings.bed === "333x88";

  return (
    <div className="app">
      <header className="topbar">
        <svg className="logo" viewBox="0 0 32 32" aria-hidden>
          <rect x="3" y="3" width="26" height="26" rx="8" fill="#1A222C" stroke="#3DDC97" strokeWidth="2" />
          <circle cx="12" cy="12" r="3" fill="#3DDC97" />
          <circle cx="20" cy="12" r="3" fill="#5B8DEF" />
          <circle cx="12" cy="20" r="3" fill="#5B8DEF" />
          <circle cx="20" cy="20" r="3" fill="#3DDC97" />
        </svg>
        <h1>
          Jiggmaker <span>· eufyMake E1</span>
        </h1>
        <span className="sp" />
        <button className="ghost" type="button" onClick={() => setHelp(true)}>
          Cómo funciona
        </button>
      </header>

      <div className="shell">
        <aside className="controls">
          <div className="steps">
            {(["setup", "layout", "output"] as StepId[]).map((id) => (
              <button key={id} type="button" className={step === id ? "on" : ""} onClick={() => setStep(id)}>
                {id === "setup" ? "Setup" : id === "layout" ? "Layout" : "Output"}
              </button>
            ))}
          </div>

          {step === "setup" && (
            <>
              <section className="card">
                <h2>Objetos · hasta {MAX_OBJECTS}</h2>
                {objects.map((o, i) => (
                  <ObjectCard
                    key={o.id}
                    obj={o}
                    index={i}
                    canRemove={objects.length > 1}
                    onChange={(p) =>
                      setObjects((list) => list.map((x) => (x.id === o.id ? { ...x, ...p } : x)))
                    }
                    onRemove={() => {
                      setStlMap((m) => {
                        const next = { ...m };
                        delete next[o.id];
                        return next;
                      });
                      setObjects((list) => list.filter((x) => x.id !== o.id));
                    }}
                    onStl={(f) => onStl(o.id, f)}
                  />
                ))}
                {objects.length < MAX_OBJECTS && (
                  <button className="btn" type="button" style={{ width: "100%" }} onClick={() => setObjects((l) => [...l, newObject(l.length)])}>
                    + Añadir objeto
                  </button>
                )}
                <p className="hint">
                  Cada objeto tiene orientación, pocket (silueta o rectángulo) y cantidad. Sin STL puedes definir un
                  rectángulo a mano.
                </p>
              </section>
              <section className="card">
                <h2>Cama</h2>
                <div className="row">
                  <label>Flatbed</label>
                  <select
                    value={settings.bed}
                    onChange={(e) => {
                      const bed = e.target.value as JobSettings["bed"];
                      patchSettings({ bed, useAdapter: bed === "333x88" ? settings.useAdapter : false });
                    }}
                  >
                    <option value="333x88">Mini · 333 × 88 mm</option>
                    <option value="333x418">Large · 333 × 418 mm</option>
                    <option value="custom">Custom…</option>
                  </select>
                </div>
                {settings.bed === "custom" && (
                  <div className="row">
                    <label>W × H mm</label>
                    <input type="number" min={10} value={settings.bedW} onChange={(e) => patchSettings({ bedW: +e.target.value })} />
                    <input type="number" min={10} value={settings.bedH} onChange={(e) => patchSettings({ bedH: +e.target.value })} />
                  </div>
                )}
                {mini && (
                  <label className="chk">
                    <input
                      type="checkbox"
                      checked={settings.useAdapter}
                      onChange={(e) => patchSettings({ useAdapter: e.target.checked })}
                    />
                    <span>
                      Jig para alignment frame
                      {settings.useAdapter && <span className="pill">usando frame</span>}
                    </span>
                  </label>
                )}
                {settings.useAdapter && mini && (
                  <p className="hint">
                    Placa 334 × 90 mm, esquinas redondeadas. Full = largo completo. Tight = acorta en X y alinea al borde
                    derecho del frame. La plantilla sigue en cama Mini 333 × 88.
                  </p>
                )}
                {!mini && (
                  <div className="stub">Large-frame system · próximamente (stub). Usa Large bed sin frame por ahora.</div>
                )}
              </section>
            </>
          )}

          {step === "layout" && (
            <section className="card">
              <h2>Layout</h2>
              <label className="chk">
                <input type="checkbox" checked={settings.nest} onChange={(e) => patchSettings({ nest: e.target.checked })} />
                Nest rows (stagger)
              </label>
              <div className="row">
                <label>Spacing X / Y mm</label>
                <input type="number" min={0} step={0.5} value={settings.spacingX} onChange={(e) => patchSettings({ spacingX: +e.target.value })} />
                <input type="number" min={0} step={0.5} value={settings.spacingY} onChange={(e) => patchSettings({ spacingY: +e.target.value })} />
              </div>
              <div className="row">
                <label>Margin X / Y mm</label>
                <input type="number" min={0} step={0.5} value={settings.marginX} onChange={(e) => patchSettings({ marginX: +e.target.value })} />
                <input type="number" min={0} step={0.5} value={settings.marginY} onChange={(e) => patchSettings({ marginY: +e.target.value })} />
              </div>
              <div className="row">
                <label>Gap entre objetos mm</label>
                <input type="number" min={0} step={0.5} value={settings.objGap} onChange={(e) => patchSettings({ objGap: +e.target.value })} />
              </div>
              {settings.nest && (
                <div className="row">
                  <label>Row offset %</label>
                  <input type="number" min={0} max={100} step={5} value={settings.offsetPct} onChange={(e) => patchSettings({ offsetPct: +e.target.value })} />
                </div>
              )}
              <div className="row">
                <label>Huella / footprint</label>
                <select value={settings.footprint} onChange={(e) => patchSettings({ footprint: e.target.value as JobSettings["footprint"] })}>
                  <option value="bed">Full bed</option>
                  <option value="tight">Tight to parts</option>
                </select>
              </div>
              <label className="chk">
                <input type="checkbox" checked={settings.center} onChange={(e) => patchSettings({ center: e.target.checked })} />
                Centrar array en la cama
              </label>
            </section>
          )}

          {step === "output" && (
            <>
              <section className="card">
                <h2>Jig 3D (PLA)</h2>
                <div className="row">
                  <label>Base thickness mm</label>
                  <input type="number" min={0} step={0.2} value={settings.baseThk} onChange={(e) => patchSettings({ baseThk: +e.target.value })} />
                </div>
                <div className="row">
                  <label>Pocket depth mm</label>
                  <input type="number" min={0.5} step={0.5} value={settings.pocketDepth} onChange={(e) => patchSettings({ pocketDepth: +e.target.value })} />
                </div>
                <label className="chk">
                  <input type="checkbox" checked={settings.scaleComp} onChange={(e) => patchSettings({ scaleComp: e.target.checked })} />
                  scaleComp 1.003 (solo STL)
                </label>
                <p className="hint">
                  Un sólido. Base = 0 → through-hole (sin suelo; no se aplica pocketDepthExtra 0.2). DXF/SVG no usan
                  scaleComp.
                </p>
                <div className="row">
                  <label>maxPrintBed mm</label>
                  <input type="number" min={100} step={1} value={settings.maxPrintBed} onChange={(e) => patchSettings({ maxPrintBed: +e.target.value })} />
                </div>
                <label className="chk">
                  <input type="checkbox" checked={settings.splitPlate} onChange={(e) => patchSettings({ splitPlate: e.target.checked })} />
                  Split si la placa &gt; maxPrintBed
                </label>
              </section>
              <section className="card">
                <h2>Láser · 2 hojas</h2>
                <div className="row">
                  <label>Material thickness mm</label>
                  <input type="number" min={0.5} step={0.5} value={settings.matThk} onChange={(e) => patchSettings({ matThk: +e.target.value })} />
                </div>
                <label className="chk">
                  <input type="checkbox" checked={settings.pickOut} onChange={(e) => patchSettings({ pickOut: e.target.checked })} />
                  Pick-out hole bajo cada pocket
                </label>
                {settings.pickOut && (
                  <div className="row">
                    <label>Hole Ø mm</label>
                    <input type="number" min={2} step={1} value={settings.pickDia} onChange={(e) => patchSettings({ pickDia: +e.target.value })} />
                  </div>
                )}
                <p className="hint">
                  Pocket sheet + base sheet, bonded. Pocket depth ≈ {settings.matThk} mm × 1 hoja.
                </p>
              </section>
              <section className="card">
                <h2>Plantilla Studio</h2>
                <div className="row">
                  <label>PNG DPI</label>
                  <input type="number" min={72} step={50} value={settings.dpi} onChange={(e) => patchSettings({ dpi: +e.target.value })} />
                </div>
                <label className="chk">
                  <input type="checkbox" checked={settings.showNum} onChange={(e) => patchSettings({ showNum: e.target.checked })} />
                  Numerar posiciones
                </label>
              </section>
              <section className="card">
                <h2>Jobs guardados</h2>
                <div className="row">
                  <input
                    type="text"
                    placeholder="Nombre del job"
                    value={histName}
                    onChange={(e) => setHistName(e.target.value)}
                    style={{ flex: 1, width: "auto" }}
                    onKeyDown={(e) => e.key === "Enter" && saveJob()}
                  />
                </div>
                <div className="row" style={{ gap: 8 }}>
                  <button className="btn primary" type="button" onClick={saveJob}>
                    Save
                  </button>
                  <button className="btn" type="button" onClick={exportHistory}>
                    Export…
                  </button>
                  <button className="btn" type="button" onClick={() => importRef.current?.click()}>
                    Import…
                  </button>
                  <input
                    ref={importRef}
                    type="file"
                    accept="application/json,.json"
                    hidden
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) importHistory(f);
                      e.target.value = "";
                    }}
                  />
                </div>
                <p className="hint">
                  Misma clave <code>{HISTORY_KEY}</code> en Docker (NAS) y GitHub Pages. Cada origen tiene su propio
                  almacén; usa Export/Import <code>{HISTORY_FILENAME}</code> para copiar jobs entre ellos.
                </p>
                {history.length === 0 && <div className="hint">No saved jobs yet.</div>}
                {history.map((j) => (
                  <div className="histitem" key={j.id}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="hi-name">{j.name || "(untitled)"}</div>
                      <div className="hi-date">
                        {j.date?.slice(0, 16).replace("T", " ")} · {(j.objects || []).length} obj
                      </div>
                    </div>
                    <button className="btn" type="button" onClick={() => loadJob(j)}>
                      Load
                    </button>
                    <button
                      className="ghost"
                      type="button"
                      onClick={() => {
                        if (!confirm("¿Borrar " + (j.name || "untitled") + "?")) return;
                        const next = loadHistory().filter((x) => x.id !== j.id);
                        saveHistory(next);
                        setHistory(next);
                      }}
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </section>
            </>
          )}
        </aside>

        <div className="workspace">
        <div className="preview-col">
          {result.warn && <div className="warnbar">{result.warn}</div>}
          <div className="preview-card">
            <div className="preview-hd">
              <b>Preview</b>
              <div className="seg">
                {(
                  [
                    ["template", "Template"],
                    ["jig3d", "3D jig"],
                    ["laserPocket", "Laser pocket"],
                    ["laserBase", "Laser base"],
                  ] as Array<[PreviewMode, string]>
                ).map(([id, lab]) => (
                  <button key={id} type="button" className={preview === id ? "on" : ""} onClick={() => setPreview(id)}>
                    {lab}
                  </button>
                ))}
              </div>
              <span className="sp" />
              <input type="color" value={jigColor} onChange={(e) => setJigColor(e.target.value)} title="color 3D" />
            </div>
            <div className="canvas-wrap">
              <Preview
                result={result}
                mode={preview}
                showNum={settings.showNum}
                jigColor={jigColor}
                resetToken={viewReset}
                onMove={onMove}
              />
            </div>
            <div className="preview-ft">
              <p className="hint">Scroll to zoom, drag empty space to pan · Template: drag piece to reposition</p>
              <div className="preview-actions">
                <button className="ghost" type="button" onClick={() => setViewReset((n) => n + 1)}>
                  Reset view
                </button>
                <button className="ghost" type="button" onClick={() => setMoves({})}>
                  Reset positions
                </button>
              </div>
            </div>
            <div className="legend">
              <span>
                <i style={{ borderColor: "var(--cut)" }} />
                cut
              </span>
              <span>
                <i style={{ borderColor: "var(--score)" }} />
                score / registration
              </span>
              <span>
                <i style={{ borderColor: "var(--bed)" }} />
                bed edge
              </span>
            </div>
          </div>

          <div className="card">
            <h2>Descargas</h2>
            <div className="dlgrid">
              <button
                type="button"
                onClick={() => {
                  const f = laserFiles(result, stem).find((x) => x.name.endsWith("_POCKET.dxf") || x.name.includes("_s1_POCKET"));
                  if (f) downloadBytes(f.name, f.data, f.mime);
                }}
              >
                <b>Pocket DXF</b>
                <span>CUT rojo · mm</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  const f = laserFiles(result, stem).find((x) => x.name.endsWith("_BASE.dxf") || x.name.includes("_s1_BASE.dxf"));
                  if (f) downloadBytes(f.name, f.data, f.mime);
                }}
              >
                <b>Base DXF</b>
                <span>backing</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  const f = laserFiles(result, stem).find((x) => x.name.endsWith("_POCKET.svg") || x.name.includes("_s1_POCKET.svg"));
                  if (f) downloadBytes(f.name, f.data, f.mime);
                }}
              >
                <b>Pocket SVG</b>
                <span>red=cut blue=score</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  const f = laserFiles(result, stem).find((x) => x.name.endsWith("_BASE.svg") || x.name.includes("_s1_BASE.svg"));
                  if (f) downloadBytes(f.name, f.data, f.mime);
                }}
              >
                <b>Base SVG</b>
                <span>red=cut blue=score</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  const f = stlFiles(result, stem)[0];
                  downloadBytes(f.name, f.data, f.mime);
                }}
              >
                <b>Jig STL</b>
                <span>un sólido{settings.scaleComp ? " · ×1.003" : ""}</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  const f = stlFiles(result, stem).find((x) => x.name.includes("_ascii"));
                  if (f) downloadBytes(f.name, f.data, f.mime);
                }}
              >
                <b>STL ASCII</b>
                <span>compatibilidad</span>
              </button>
              <button type="button" onClick={() => downloadPng()}>
                <b>Template PNG</b>
                <span>{settings.dpi} dpi</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  const f = templateSvg(result, stem);
                  downloadBytes(f.name, f.data, f.mime);
                }}
              >
                <b>Template SVG</b>
                <span>cama completa</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  const f = contoursSvg(result, stem);
                  downloadBytes(f.name, f.data, f.mime);
                }}
              >
                <b>Contours SVG</b>
                <span>auto-detect</span>
              </button>
              {settings.splitPlate && result.splits.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    for (const f of [...laserFiles(result, stem), ...stlFiles(result, stem)]) {
                      downloadBytes(f.name, f.data, f.mime);
                    }
                  }}
                >
                  <b>Download split set</b>
                  <span>{result.splits.length} piezas</span>
                </button>
              )}
            </div>
          </div>
        </div>
        <aside className="preview-rail">
          <PartViewport
            objects={objects}
            stlMap={stlMap}
            onChange={(id, p) => setObjects((list) => list.map((x) => (x.id === id ? { ...x, ...p } : x)))}
          />
          <SummaryCard result={result} />
        </aside>
        </div>
      </div>

      <canvas ref={pngCanvas} hidden />

      {help && (
        <div className="modal" onClick={() => setHelp(false)}>
          <div className="box" onClick={(e) => e.stopPropagation()}>
            <h3>Cómo funciona</h3>
            <p>
              <b>1 · Objetos.</b> STL o rectángulo W×H. Hasta 3, cada uno con qty, eje up, rotación y pocket silueta o
              bounding box. Clearance 0.15 mm por defecto.
            </p>
            <p>
              <b>2 · Cama y frame.</b> Mini 333×88, Large 333×418 o custom. En Mini, el checkbox de frame pasa la placa a
              334×90 (esquinas redondeadas). Tight alinea a la derecha del frame. Large-frame queda stub.
            </p>
            <p>
              <b>3 · Láser vs 3D.</b> Láser = 2 hojas (POCKET + BASE) sin scaleComp. 3D = un STL; PLA aplica scaleComp
              1.003 si está activo. Base 0 = through-hole.
            </p>
            <p>
              <b>4 · Impresión FDM.</b> Objetivo 250×250×250. Placas 333/334 se asumen H2 por defecto; aviso + maxPrintBed
              250 y opción split.
            </p>
            <p>
              Importa la plantilla en eufyMake Studio a tamaño de cama, coloca el arte en los contornos, oculta la
              plantilla y usa Zero Point Alignment. El 0,0 de la plantilla es la esquina de registro.
            </p>
            <p>
              <b>Jobs.</b> Se guardan en este navegador (<code>eufyJig.history.v1</code>), igual en Docker y en GitHub
              Pages. Cada URL tiene su propio almacén: Export/Import JSON para copiar entre el NAS y Pages.
            </p>
            <button className="btn primary" type="button" onClick={() => setHelp(false)}>
              Entendido
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
