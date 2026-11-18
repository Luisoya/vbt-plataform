/** Formato numérico español: coma decimal. */
export function fmt(x: number | null | undefined, d = 2): string {
  if (x == null || !Number.isFinite(x)) return '—';
  return x.toLocaleString('es-ES', { minimumFractionDigits: d, maximumFractionDigits: d, useGrouping: false });
}

/** Diferencia con signo explícito. */
export function fmtSigned(x: number | null | undefined, d = 3): string {
  if (x == null || !Number.isFinite(x)) return '—';
  return (x >= 0 ? '+' : '−') + fmt(Math.abs(x), d);
}

/** Convierte el texto de un campo a número (acepta coma o punto). Vacío o no numérico → null. */
export function parseNum(s: string): number | null {
  const t = s.trim().replace(',', '.');
  if (t === '') return null;
  if (!/^[-+]?(\d+\.?\d*|\.\d+)$/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** Texto inválido (no vacío y no numérico). */
export function isInvalidNum(s: string): boolean {
  return s.trim() !== '' && parseNum(s) == null;
}

/** Número → texto editable con coma decimal. */
export function numToInput(n: number | null | undefined): string {
  return n == null ? '' : String(n).replace('.', ',');
}
