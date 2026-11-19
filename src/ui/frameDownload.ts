/** Static E1 Mini frame STLs in `public/frame/`. Printed once; not part of jig export. */

export const FRAME_DOWNLOAD_HINT =
  "Imprime las dos piezas con el tope hacia la cama; el hueco es 334.5 × 90.4 mm para el jig Mini de 334 × 90.";

export const FRAME_PARTS = [
  { file: "marco_E1_izq.stl", label: "Marco izquierdo (STL)" },
  { file: "marco_E1_der.stl", label: "Marco derecho (STL)" },
] as const;

/**
 * URL for a file under `public/frame/`.
 * `baseUrl` is Vite's `import.meta.env.BASE_URL` (`/` in Docker, `/Jiggmaker/` on Pages).
 */
export function frameAssetUrl(baseUrl: string, file: string): string {
  const base = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  return `${base}frame/${file}`;
}
