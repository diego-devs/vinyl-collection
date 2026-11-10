const FORMULA_PREFIX = /^[=+\-@\t\r]/;

/** Escapes a CSV cell (RFC 4180) and neutralizes spreadsheet formula injection. */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  let s = Array.isArray(value) ? value.join("; ") : String(value);
  if (FORMULA_PREFIX.test(s)) s = `'${s}`;
  if (/[",\n\r]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function toCsv(header: string[], rows: unknown[][]): string {
  const lines = [header.map(csvCell).join(","), ...rows.map((r) => r.map(csvCell).join(","))];
  // BOM so Excel detects UTF-8 (accents, ñ).
  return "\uFEFF" + lines.join("\r\n") + "\r\n";
}
