/**
 * Cálculo de un test según el modelo del ejercicio:
 *  - 'linear' (sentadilla, press de banca · VMP): V = a + b·Carga; 1RM estimado con la V1RM.
 *  - 'poly2'  (remo tumbado · VMAX): V = c0 + c1·%1RM + c2·%1RM², con 1RM medido.
 * Toda la matemática vive en shared/calc.ts; aquí solo se prepara lo que muestra la interfaz.
 */
import {
  estimateOneRM,
  isValidCurve,
  isValidPolyCurve,
  linearFit,
  percentTable,
  polyAt,
  polyFit2,
  polyPercentCoefficients,
  polyPercentTable,
  polyTestWarnings,
  testWarnings,
  velocityAtLoad,
  type PercentRow,
  type ValidPoint,
} from '../../shared/calc.ts';
import type { ExerciseConfig } from '../../shared/exercises.ts';
import { fmt, parseNum } from './format.ts';

export interface TestInput {
  points: { load: string; vel: string }[];
  v1rm: string;
  oneRm: string;
}

export interface ChartCurve {
  points: ValidPoint[];
  line: { x: number; y: number }[] | null;
  lineLabel: string;
  marker: { x: number; y: number; label: string } | null;
}

export interface TestComputation {
  ok: boolean;
  equation: string | null;
  r2: number | null;
  stats: { k: string; v: string }[];
  warnings: string[];
  table: PercentRow[];
  chart: ChartCurve;
  /** Curva válida como referencia (existe y la velocidad disminuye con la carga). */
  validCurve: boolean;
  /** Velocidad de la curva para una carga (null si la curva no es válida o la carga no es válida). */
  velocityAt: (load: number | null) => number | null;
}

function signed(x: number, d: number) {
  return `${x < 0 ? '−' : '+'} ${fmt(Math.abs(x), d)}`;
}

export function toPoints(input: Pick<TestInput, 'points'>) {
  return input.points.map((p) => ({ load: parseNum(p.load), velocity: parseNum(p.vel) }));
}

/* ---------- Modelo lineal ---------- */
function linearWarning(w: ReturnType<typeof testWarnings>[number], ex: ExerciseConfig): string {
  const vt = ex.velocityVariable;
  switch (w) {
    case 'insufficient-points':
      return 'Introduce al menos 2 pares carga-velocidad válidos para calcular la curva.';
    case 'equal-loads':
      return 'Todas las cargas son iguales: no se puede ajustar la recta. Introduce cargas distintas.';
    case 'few-points':
      return 'Hay menos de 4 cargas: estimación poco robusta.';
    case 'non-negative-slope':
      return 'La pendiente no es negativa: la velocidad debe disminuir al aumentar la carga. Revisa los datos. No se estima el 1RM.';
    case 'missing-v1rm':
      return ex.defaultV1rm == null
        ? `Introduce la ${vt} individual registrada en el 1RM del deportista. Hasta entonces no se estima el 1RM ni se genera la tabla de porcentajes.`
        : `Introduce la ${vt} en el 1RM para estimar el 1RM y generar la tabla de porcentajes.`;
    case 'invalid-one-rm':
      return `La ${vt} en el 1RM es igual o superior a la ordenada en el origen de la recta: no se puede estimar el 1RM.`;
  }
}

function computeLinear(ex: ExerciseConfig, input: TestInput): TestComputation {
  const vt = ex.velocityVariable;
  const fit = linearFit(toPoints(input));
  const v1rm = parseNum(input.v1rm);
  const oneRM = estimateOneRM(fit, v1rm);
  const valid = isValidCurve(fit);
  let line: ChartCurve['line'] = null;
  if (fit.ok) {
    // Recta de 0 kg al 1RM estimado (o a la carga máxima si no hay 1RM).
    const xEnd = oneRM ?? Math.max(...fit.points.map((p) => p.load));
    line = [
      { x: 0, y: fit.a },
      { x: xEnd, y: fit.a + fit.b * xEnd },
    ];
  }
  return {
    ok: fit.ok,
    equation: fit.ok ? `${vt} = ${fmt(fit.a, 4)} ${signed(fit.b, 5)} · Carga (kg)` : null,
    r2: fit.ok ? fit.r2 : null,
    stats: fit.ok
      ? [
          { k: 'R²', v: fmt(fit.r2, 4) },
          { k: 'Nº de pares', v: String(fit.n) },
          { k: 'Pendiente (m/s por kg)', v: fmt(fit.b, 5) },
          { k: '1RM estimado', v: oneRM != null ? `${fmt(oneRM, 1)} kg` : '—' },
        ]
      : [],
    warnings: testWarnings(fit, v1rm).map((w) => linearWarning(w, ex)),
    table: percentTable(fit, oneRM),
    chart: {
      points: fit.points,
      line,
      lineLabel: 'recta de regresión',
      marker: oneRM != null && v1rm != null ? { x: oneRM, y: v1rm, label: '1RM estimado' } : null,
    },
    validCurve: valid,
    velocityAt: (load) => (valid && load != null && load > 0 ? velocityAtLoad(fit, load) : null),
  };
}

/* ---------- Modelo polinómico de 2.º grado con 1RM medido (remo tumbado) ---------- */
function polyWarning(w: ReturnType<typeof polyTestWarnings>[number], ex: ExerciseConfig): string {
  const vt = ex.velocityVariable;
  switch (w) {
    case 'insufficient-points':
      return 'Introduce al menos 3 pares carga-velocidad válidos para ajustar el polinomio de 2.º grado.';
    case 'few-distinct-loads':
      return 'Se necesitan al menos 3 cargas distintas para ajustar el polinomio de 2.º grado.';
    case 'few-points':
      return 'Hay menos de 4 cargas: estimación poco robusta.';
    case 'non-decreasing':
      return `La curva no es decreciente en todo el rango de cargas: la ${vt} debe disminuir al aumentar la carga. Revisa los datos. No se genera la tabla ni se usa como referencia.`;
    case 'missing-one-rm':
      return 'Introduce el 1RM medido (kg) para expresar la ecuación en %1RM y generar la tabla de porcentajes.';
    case 'load-above-one-rm':
      return 'Hay cargas superiores al 1RM medido. Revisa el 1RM o los datos.';
  }
}

function computePoly(ex: ExerciseConfig, input: TestInput): TestComputation {
  const vt = ex.velocityVariable;
  const fit = polyFit2(toPoints(input));
  const oneRMraw = parseNum(input.oneRm);
  const oneRM = oneRMraw != null && oneRMraw > 0 ? oneRMraw : null;
  const valid = isValidPolyCurve(fit, oneRM);

  let equation: string | null = null;
  let line: ChartCurve['line'] = null;
  let marker: ChartCurve['marker'] = null;
  if (fit.ok) {
    if (oneRM != null) {
      const k = polyPercentCoefficients(fit, oneRM);
      equation = `${vt} = ${fmt(k.c0, 4)} ${signed(k.c1, 5)} · %1RM ${signed(k.c2, 7)} · %1RM²`;
    } else {
      equation = `${vt} = ${fmt(fit.a, 4)} ${signed(fit.b, 5)} · Carga ${signed(fit.c, 7)} · Carga² (kg)`;
    }
    // Curva dibujada en el rango medido (de la carga mínima al 1RM medido o la carga máxima).
    const x0 = fit.minLoad;
    const x1 = Math.max(fit.maxLoad, oneRM ?? 0);
    const N = 60;
    line = Array.from({ length: N + 1 }, (_, i) => {
      const x = x0 + ((x1 - x0) * i) / N;
      return { x, y: polyAt(fit, x) };
    });
    if (oneRM != null) marker = { x: oneRM, y: polyAt(fit, oneRM), label: '1RM medido' };
  }

  return {
    ok: fit.ok,
    equation,
    r2: fit.ok ? fit.r2 : null,
    stats: fit.ok
      ? [
          { k: 'R²', v: fmt(fit.r2, 4) },
          { k: 'Nº de pares', v: String(fit.n) },
          { k: `${vt} en el 1RM (curva)`, v: oneRM != null ? `${fmt(polyAt(fit, oneRM), 2)} m/s` : '—' },
          { k: '1RM medido', v: oneRM != null ? `${fmt(oneRM, 1)} kg` : '—' },
        ]
      : [],
    warnings: polyTestWarnings(fit, oneRM).map((w) => polyWarning(w, ex)),
    table: polyPercentTable(fit, oneRM),
    chart: { points: fit.points, line, lineLabel: 'curva polinómica (2.º grado)', marker },
    validCurve: valid,
    velocityAt: (load) => (valid && load != null && load > 0 ? polyAt(fit as Extract<typeof fit, { ok: true }>, load) : null),
  };
}

export function computeTest(ex: ExerciseConfig, input: TestInput): TestComputation {
  return ex.model === 'poly2' ? computePoly(ex, input) : computeLinear(ex, input);
}
