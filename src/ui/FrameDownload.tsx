import { FRAME_DOWNLOAD_HINT, FRAME_PARTS, frameAssetUrl } from "./frameDownload";

/** Both E1 Mini frame pieces. Shown only while the Mini bed is selected. */
export function FrameDownload() {
  const base = import.meta.env.BASE_URL;
  return (
    <div className="frame-download">
      <div className="frame-download-label">Descargar marco</div>
      <div className="frame-download-actions">
        {FRAME_PARTS.map((part) => (
          <a key={part.file} href={frameAssetUrl(base, part.file)} download={part.file}>
            {part.label}
          </a>
        ))}
      </div>
      <p className="hint">{FRAME_DOWNLOAD_HINT}</p>
    </div>
  );
}
