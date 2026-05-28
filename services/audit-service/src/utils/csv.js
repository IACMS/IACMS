/**
 * Minimal CSV row escape for compliance export.
 */
export function csvEscape(value) {
  if (value == null) return '';
  const s = String(value);
  if (/[,"\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}
