/** Up to `digits` decimals, without trailing zeros. 1.5 stays 1.5; 2.75 stays 2.75; 3 stays 3. */
export function formatMm(n: number, digits = 2): string {
  if (!Number.isFinite(n)) return "0";
  const factor = 10 ** digits;
  const rounded = Math.round(n * factor) / factor;
  return String(rounded);
}
