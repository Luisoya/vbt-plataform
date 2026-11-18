/**
 * Lógica de cálculo pura de la relación carga-velocidad individual.
 * Sin dependencias de la interfaz ni del servidor.
 *
 * Criterios (González-Badillo y Sánchez-Medina):
 *  - Regresión lineal individual por mínimos cuadrados: V = a + b · Carga(kg), con b < 0.
 *  - R² = 1 − SSres / SStot.
 *  - 1RM estimado = carga a la que la recta alcanza la velocidad del 1RM: 1RM = (V1RM − a) / b.
 *  - Velocidad en un X % 1RM = a + b · (X/100 · 1RM); carga equivalente = X/100 · 1RM.
 */

export interface LoadVelocityPoint {
  load: number | null | undefined;
  velocity: number | null | undefined;
}

export interface ValidPoint {
  load: number;
  velocity: number;
}

export type FitFailure = 'insufficient-points' | 'equal-loads';

export interface FitOk {
  ok: true;
  /** Nº de pares válidos utilizados. */
  n: number;
  /** Ordenada en el origen (m/s). */
  a: number;
  /** Pendiente (m/s por kg). */
  b: number;
  /** Coeficiente de determinación; null si SStot = 0 (todas las velocidades iguales). */
  r2: number | null;
  points: ValidPoint[];
}

export interface FitFail {
  ok: false;
  n: number;
  reason: FitFailure;
  points: ValidPoint[];
}

export type FitResult = FitOk | FitFail;

/** Mínimo de pares para calcular la recta. */
export const MIN_POINTS = 2;
/** Por debajo de este nº de cargas se avisa de «estimación poco robusta». */
export const ROBUST_POINTS = 4;
/** Porcentajes de la tabla de intensidades. */
export const PERCENTS = [50, 55, 60, 65, 70, 75, 80] as const;

function isPositiveFinite(x: unknown): x is number {
  return typeof x === 'number' && Number.isFinite(x) && x > 0;
}

/** Pares válidos: carga y velocidad numéricas, finitas y positivas. */
export function validPoints(points: LoadVelocityPoint[]): ValidPoint[] {
  return points
    .filter((p) => isPositiveFinite(p.load) && isPositiveFinite(p.velocity))
    .map((p) => ({ load: p.load as number, velocity: p.velocity as number }));
}

/** Ajuste lineal por mínimos cuadrados V = a + b · Carga. */
export function linearFit(points: LoadVelocityPoint[]): FitResult {
  const p = validPoints(points);
  const n = p.length;
  if (n < MIN_POINTS) return { ok: false, n, reason: 'insufficient-points', points: p };

  const mx = p.reduce((s, r) => s + r.load, 0) / n;
  const my = p.reduce((s, r) => s + r.velocity, 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (const r of p) {
    sxy += (r.load - mx) * (r.velocity - my);
    sxx += (r.load - mx) ** 2;
    syy += (r.velocity - my) ** 2;
  }
  if (sxx === 0) return { ok: false, n, reason: 'equal-loads', points: p };

  const b = sxy / sxx;
  const a = my - b * mx;
  const ssRes = p.reduce((s, r) => s + (r.velocity - (a + b * r.load)) ** 2, 0);
  const r2 = syy === 0 ? null : 1 - ssRes / syy;
  return { ok: true, n, a, b, r2, points: p };
}

/** La recta es válida para estimar cargas solo si existe y su pendiente es negativa. */
export function isValidCurve(fit: FitResult): fit is FitOk {
  return fit.ok && fit.b < 0;
}

/** Velocidad predicha por la recta para una carga. */
export function velocityAtLoad(fit: FitOk, load: number): number {
  return fit.a + fit.b * load;
}

/**
 * 1RM estimado = (V1RM − a) / b.
 * Devuelve null si la recta no es válida (no existe o b ≥ 0), si V1RM está vacío o no es positivo,
 * o si el resultado no es una carga positiva (V1RM ≥ a).
 */
export function estimateOneRM(fit: FitResult, v1rm: number | null | undefined): number | null {
  if (!isValidCurve(fit)) return null;
  if (!isPositiveFinite(v1rm)) return null;
  const load = (v1rm - fit.a) / fit.b;
  return Number.isFinite(load) && load > 0 ? load : null;
}

export interface PercentRow {
  percent: number;
  /** Velocidad sobre la recta individual (m/s). */
  velocity: number;
  /** Carga equivalente (kg). */
  load: number;
}

/** Tabla 50–80 % 1RM en pasos del 5 %. Vacía si no hay recta válida o 1RM. */
export function percentTable(fit: FitResult, oneRM: number | null): PercentRow[] {
  if (!isValidCurve(fit) || oneRM == null || !(oneRM > 0)) return [];
  return PERCENTS.map((percent) => {
    const load = (percent / 100) * oneRM;
    return { percent, load, velocity: velocityAtLoad(fit, load) };
  });
}

/** Velocidad de referencia del pre-test para una carga: a_pre + b_pre · carga. */
export function referenceVelocity(preFit: FitResult, load: number | null | undefined): number | null {
  if (!isValidCurve(preFit) || !isPositiveFinite(load)) return null;
  return velocityAtLoad(preFit, load);
}

/** Diferencia = velocidad 1.ª repetición − velocidad de referencia del pre-test para esa carga. */
export function trackingDifference(
  preFit: FitResult,
  load: number | null | undefined,
  firstRepVelocity: number | null | undefined,
): number | null {
  const ref = referenceVelocity(preFit, load);
  if (ref == null || !isPositiveFinite(firstRepVelocity)) return null;
  return firstRepVelocity - ref;
}

/* =====================================================================================
 * REMO TUMBADO (VMAX) — Modelo polinómico de 2.º grado con 1RM medido
 * Espinosa-Retamal, Fink, Jiménez-Lozano, Herrera-Bermudo, Yáñez-García, González-Badillo y
 * Rodríguez-Rosell (2026). J Funct Morphol Kinesiol 11(4):429:
 *  - Relación individual entre %1RM y Vmax ajustada con un polinomio de 2.º grado.
 *  - 1RM determinado directamente (no estimado) y Vmax registrada en esa repetición.
 *  - La ecuación individual se usa para calcular la Vmax correspondiente a cada %1RM.
 * Se ajusta V = a + b·Carga + c·Carga² (kg). Como %1RM = Carga/1RM·100 es un cambio de escala,
 * el ajuste es idéntico al del artículo y se expresa también como V = c0 + c1·%1RM + c2·%1RM².
 * ===================================================================================== */

export type PolyFitFailure = 'insufficient-points' | 'few-distinct-loads';

export interface PolyFitOk {
  ok: true;
  n: number;
  /** V = a + b·Carga + c·Carga² (kg) */
  a: number;
  b: number;
  c: number;
  r2: number | null;
  points: ValidPoint[];
  minLoad: number;
  maxLoad: number;
}

export interface PolyFitFail {
  ok: false;
  n: number;
  reason: PolyFitFailure;
  points: ValidPoint[];
}

export type PolyFitResult = PolyFitOk | PolyFitFail;

export const POLY_MIN_POINTS = 3;

/** Resuelve un sistema 3×3 por eliminación gaussiana con pivoteo parcial. null si es singular. */
function solve3(m: number[][], v: number[]): number[] | null {
  const A = m.map((row, i) => [...row, v[i]]);
  for (let col = 0; col < 3; col++) {
    let piv = col;
    for (let r = col + 1; r < 3; r++) if (Math.abs(A[r][col]) > Math.abs(A[piv][col])) piv = r;
    if (Math.abs(A[piv][col]) < 1e-12) return null;
    [A[col], A[piv]] = [A[piv], A[col]];
    for (let r = col + 1; r < 3; r++) {
      const f = A[r][col] / A[col][col];
      for (let k = col; k < 4; k++) A[r][k] -= f * A[col][k];
    }
  }
  const x = [0, 0, 0];
  for (let r = 2; r >= 0; r--) {
    let s = A[r][3];
    for (let k = r + 1; k < 3; k++) s -= A[r][k] * x[k];
    x[r] = s / A[r][r];
  }
  return x;
}

/** Ajuste por mínimos cuadrados V = a + b·Carga + c·Carga². */
export function polyFit2(points: LoadVelocityPoint[]): PolyFitResult {
  const p = validPoints(points);
  const n = p.length;
  if (n < POLY_MIN_POINTS) return { ok: false, n, reason: 'insufficient-points', points: p };
  if (new Set(p.map((r) => r.load)).size < 3) return { ok: false, n, reason: 'few-distinct-loads', points: p };

  // Centrado en la media de las cargas para estabilidad numérica.
  const m = p.reduce((s, r) => s + r.load, 0) / n;
  let s1 = 0, s2 = 0, s3 = 0, s4 = 0, t0 = 0, t1 = 0, t2 = 0;
  for (const r of p) {
    const u = r.load - m;
    s1 += u; s2 += u * u; s3 += u ** 3; s4 += u ** 4;
    t0 += r.velocity; t1 += u * r.velocity; t2 += u * u * r.velocity;
  }
  const sol = solve3([[n, s1, s2], [s1, s2, s3], [s2, s3, s4]], [t0, t1, t2]);
  if (!sol) return { ok: false, n, reason: 'few-distinct-loads', points: p };
  const [p0, p1, p2] = sol;
  const a = p0 - p1 * m + p2 * m * m;
  const b = p1 - 2 * p2 * m;
  const c = p2;

  const my = t0 / n;
  const ssTot = p.reduce((s, r) => s + (r.velocity - my) ** 2, 0);
  const ssRes = p.reduce((s, r) => s + (r.velocity - (a + b * r.load + c * r.load ** 2)) ** 2, 0);
  const loads = p.map((r) => r.load);
  return {
    ok: true, n, a, b, c,
    r2: ssTot === 0 ? null : 1 - ssRes / ssTot,
    points: p,
    minLoad: Math.min(...loads),
    maxLoad: Math.max(...loads),
  };
}

/** Velocidad predicha por el polinomio para una carga (kg). */
export function polyAt(fit: PolyFitOk, load: number): number {
  return fit.a + fit.b * load + fit.c * load * load;
}

/**
 * La curva es válida si la velocidad disminuye con la carga en todo el rango de datos
 * (y hasta el 1RM medido, si se indica). La derivada b + 2c·Carga es lineal: basta comprobar los extremos.
 */
export function isValidPolyCurve(fit: PolyFitResult, oneRM?: number | null): fit is PolyFitOk {
  if (!fit.ok) return false;
  const hi = Math.max(fit.maxLoad, isPositiveFinite(oneRM) ? oneRM : 0);
  const d = (l: number) => fit.b + 2 * fit.c * l;
  return d(fit.minLoad) < 0 && d(hi) < 0;
}

/** Coeficientes en función del %1RM: V = c0 + c1·%1RM + c2·%1RM². */
export function polyPercentCoefficients(fit: PolyFitOk, oneRM: number) {
  const k = oneRM / 100;
  return { c0: fit.a, c1: fit.b * k, c2: fit.c * k * k };
}

/** Tabla 50–80 % 1RM con el polinomio y el 1RM medido. Vacía si la curva no es válida o falta el 1RM. */
export function polyPercentTable(fit: PolyFitResult, oneRM: number | null | undefined): PercentRow[] {
  if (!isPositiveFinite(oneRM) || !isValidPolyCurve(fit, oneRM)) return [];
  return PERCENTS.map((percent) => {
    const load = (percent / 100) * oneRM;
    return { percent, load, velocity: polyAt(fit, load) };
  });
}

/** Velocidad de referencia del pre-test (modelo polinómico) para una carga. */
export function polyReferenceVelocity(preFit: PolyFitResult, load: number | null | undefined): number | null {
  if (!isValidPolyCurve(preFit) || !isPositiveFinite(load)) return null;
  return polyAt(preFit, load);
}

/** Diferencia = velocidad 1.ª repetición − referencia del pre-test (modelo polinómico). */
export function polyTrackingDifference(
  preFit: PolyFitResult,
  load: number | null | undefined,
  firstRepVelocity: number | null | undefined,
): number | null {
  const ref = polyReferenceVelocity(preFit, load);
  if (ref == null || !isPositiveFinite(firstRepVelocity)) return null;
  return firstRepVelocity - ref;
}

export type PolyWarning =
  | PolyFitFailure
  | 'few-points'
  | 'non-decreasing'
  | 'missing-one-rm'
  | 'load-above-one-rm';

export function polyTestWarnings(fit: PolyFitResult, oneRM: number | null | undefined): PolyWarning[] {
  if (!fit.ok) return [fit.reason];
  const w: PolyWarning[] = [];
  if (fit.n < ROBUST_POINTS) w.push('few-points');
  if (!isValidPolyCurve(fit, oneRM)) w.push('non-decreasing');
  if (!isPositiveFinite(oneRM)) w.push('missing-one-rm');
  else if (fit.maxLoad > oneRM) w.push('load-above-one-rm');
  return w;
}

export type FitWarning =
  | 'insufficient-points'
  | 'equal-loads'
  | 'few-points'
  | 'non-negative-slope'
  | 'missing-v1rm'
  | 'invalid-one-rm';

/** Avisos asociados a un test. */
export function testWarnings(fit: FitResult, v1rm: number | null | undefined): FitWarning[] {
  if (!fit.ok) return [fit.reason];
  const w: FitWarning[] = [];
  if (fit.n < ROBUST_POINTS) w.push('few-points');
  if (fit.b >= 0) w.push('non-negative-slope');
  if (!isPositiveFinite(v1rm)) w.push('missing-v1rm');
  else if (fit.b < 0 && estimateOneRM(fit, v1rm) == null) w.push('invalid-one-rm');
  return w;
}

/* ======================================================================
 * Comparación pre-test / post-test en las cargas comunes
 * Para cada carga presente en ambos tests: cambio absoluto = V_post − V_pre (m/s)
 * y cambio relativo = (V_post − V_pre) / V_pre · 100 (%).
 * Si una carga aparece varias veces en un mismo test se usa la media de sus velocidades.
 * ====================================================================== */
export interface LoadComparisonRow {
  load: number;
  pre: number;
  post: number;
  diff: number;
  percent: number;
}

/** Tolerancia para considerar iguales dos cargas (kg), por redondeos al escribir decimales. */
const LOAD_EPS = 1e-6;

function meanByLoad(points: ValidPoint[]): Map<number, number> {
  const groups: { load: number; sum: number; n: number }[] = [];
  for (const p of points) {
    const g = groups.find((x) => Math.abs(x.load - p.load) < LOAD_EPS);
    if (g) {
      g.sum += p.velocity;
      g.n++;
    } else groups.push({ load: p.load, sum: p.velocity, n: 1 });
  }
  return new Map(groups.map((g) => [g.load, g.sum / g.n]));
}

export function commonLoadComparison(pre: LoadVelocityPoint[], post: LoadVelocityPoint[]): LoadComparisonRow[] {
  const a = meanByLoad(validPoints(pre));
  const b = meanByLoad(validPoints(post));
  const rows: LoadComparisonRow[] = [];
  for (const [load, vPre] of a) {
    const key = [...b.keys()].find((l) => Math.abs(l - load) < LOAD_EPS);
    if (key === undefined) continue;
    const vPost = b.get(key) as number;
    rows.push({ load, pre: vPre, post: vPost, diff: vPost - vPre, percent: ((vPost - vPre) / vPre) * 100 });
  }
  return rows.sort((x, y) => x.load - y.load);
}

/* ======================================================================
 * Pérdida de velocidad en la serie e Índice de Esfuerzo
 * Rodríguez-Rosell D, Yáñez-García JM, Torres-Torrelo J, Mora-Custodio R, Marques MC,
 * González-Badillo JJ (2018). Effort Index as a Novel Variable for Monitoring the Level of
 * Effort During Resistance Exercises. J Strength Cond Res 32(8):2139-2153.
 *  - %VL = (V 1.ª rep − V rep. más lenta) / V 1.ª rep · 100
 *  - IE  = V 1.ª rep (m/s) · %VL
 * ====================================================================== */
export function velocityLossPercent(first: number | null | undefined, slowest: number | null | undefined): number | null {
  if (!isPositiveFinite(first) || !isPositiveFinite(slowest) || slowest > first) return null;
  return ((first - slowest) / first) * 100;
}

export function effortIndex(first: number | null | undefined, slowest: number | null | undefined): number | null {
  const vl = velocityLossPercent(first, slowest);
  return vl == null ? null : (first as number) * vl;
}
