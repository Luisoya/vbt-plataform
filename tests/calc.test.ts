import { describe, expect, it } from 'vitest';
import {
  isValidPolyCurve,
  polyAt,
  polyFit2,
  polyPercentCoefficients,
  polyPercentTable,
  polyReferenceVelocity,
  polyTestWarnings,
  polyTrackingDifference,
  type PolyFitOk,
  estimateOneRM,
  isValidCurve,
  linearFit,
  percentTable,
  referenceVelocity,
  testWarnings,
  trackingDifference,
  type FitOk,
  commonLoadComparison,
  effortIndex,
  velocityLossPercent,
} from '../shared/calc.ts';

describe('comparación pre/post en cargas comunes', () => {
  it('solo cargas presentes en ambos tests, ordenadas, con cambio absoluto y relativo', () => {
    const pre = [
      { load: 60, velocity: 1.0 },
      { load: 40, velocity: 1.2 },
      { load: 80, velocity: 0.8 },
      { load: 100, velocity: 0.6 }, // solo en pre
    ];
    const post = [
      { load: 40, velocity: 1.26 },
      { load: 60, velocity: 0.95 },
      { load: 80, velocity: 0.8 },
      { load: 120, velocity: 0.5 }, // solo en post
      { load: null, velocity: 0.9 }, // no válido
    ];
    const rows = commonLoadComparison(pre, post);
    expect(rows.map((r) => r.load)).toEqual([40, 60, 80]);
    // 40 kg: 1,26 − 1,20 = +0,06 m/s; 0,06 / 1,20 · 100 = +5 %
    expect(rows[0].diff).toBeCloseTo(0.06, 10);
    expect(rows[0].percent).toBeCloseTo(5, 10);
    // 60 kg: 0,95 − 1,00 = −0,05 m/s → −5 %
    expect(rows[1].diff).toBeCloseTo(-0.05, 10);
    expect(rows[1].percent).toBeCloseTo(-5, 10);
    // 80 kg: sin cambio
    expect(rows[2].diff).toBe(0);
    expect(rows[2].percent).toBe(0);
  });

  it('carga repetida en un test: se usa la media de sus velocidades', () => {
    const rows = commonLoadComparison(
      [{ load: 50, velocity: 1.0 }, { load: 50, velocity: 1.1 }],
      [{ load: 50, velocity: 1.155 }],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].pre).toBeCloseTo(1.05, 10);
    expect(rows[0].percent).toBeCloseTo(10, 10);
  });

  it('sin cargas comunes → tabla vacía', () => {
    expect(commonLoadComparison([{ load: 40, velocity: 1 }], [{ load: 50, velocity: 1 }])).toEqual([]);
  });
});

describe('pérdida de velocidad e índice de esfuerzo (Rodríguez-Rosell et al., 2018)', () => {
  it('%VL = (V1 − Vlenta)/V1·100 e IE = V1 · %VL', () => {
    // V1 = 0,80; Vlenta = 0,60 → %VL = 25 %; IE = 0,80 · 25 = 20
    expect(velocityLossPercent(0.8, 0.6)).toBeCloseTo(25, 10);
    expect(effortIndex(0.8, 0.6)).toBeCloseTo(20, 10);
    // V1 = 1,00; Vlenta = 0,90 → 10 %; IE = 10
    expect(effortIndex(1.0, 0.9)).toBeCloseTo(10, 10);
    // Sin pérdida
    expect(effortIndex(0.7, 0.7)).toBe(0);
  });

  it('datos ausentes o incoherentes → sin resultado', () => {
    expect(velocityLossPercent(null, 0.5)).toBeNull();
    expect(velocityLossPercent(0.8, null)).toBeNull();
    expect(velocityLossPercent(0.8, 0.9)).toBeNull(); // la más lenta no puede ser más rápida
    expect(effortIndex(0, 0)).toBeNull();
  });
});

/*
 * Caso de referencia: (40; 1,20), (60; 1,02), (80; 0,86), (100; 0,70), (120; 0,55)
 *
 * Cálculo a mano:
 *   x̄ = 80, ȳ = 4,33 / 5 = 0,866
 *   Sxx = 1600 + 400 + 0 + 400 + 1600 = 4000
 *   Sxy = −40·0,334 − 20·0,154 + 0 + 20·(−0,166) + 40·(−0,316) = −32,4
 *   b = −32,4 / 4000 = −0,0081 ;  a = 0,866 + 0,0081·80 = 1,514
 *   Predichos: 1,190 1,028 0,866 0,704 0,542 → residuos 0,010 −0,008 −0,006 −0,004 0,008
 *   SSres = 0,00028 ;  SStot = 0,26272 ;  R² = 1 − 0,00028/0,26272 = 0,998934226...
 *   1RM (V1RM = 0,32) = (0,32 − 1,514) / −0,0081 = 147,4074 kg
 */
const REF = [
  { load: 40, velocity: 1.2 },
  { load: 60, velocity: 1.02 },
  { load: 80, velocity: 0.86 },
  { load: 100, velocity: 0.7 },
  { load: 120, velocity: 0.55 },
];
const A = 1.514;
const B = -0.0081;
const R2 = 1 - 0.00028 / 0.26272;
const ONE_RM = (0.32 - 1.514) / -0.0081;

/** Método independiente: ecuaciones normales con sumatorios brutos (Σx, Σy, Σxy, Σx², Σy²). */
function normalEquations(pts: { load: number; velocity: number }[]) {
  const n = pts.length;
  let sx = 0, sy = 0, sxy = 0, sxx = 0, syy = 0;
  for (const { load: x, velocity: y } of pts) {
    sx += x; sy += y; sxy += x * y; sxx += x * x; syy += y * y;
  }
  const b = (n * sxy - sx * sy) / (n * sxx - sx * sx);
  const a = (sy - b * sx) / n;
  const r = (n * sxy - sx * sy) / Math.sqrt((n * sxx - sx * sx) * (n * syy - sy * sy));
  return { a, b, r2: r * r };
}

function okFit(): FitOk {
  const f = linearFit(REF);
  if (!f.ok) throw new Error('el ajuste de referencia debería ser válido');
  return f;
}

describe('linearFit · caso de referencia', () => {
  it('a, b y R² coinciden con el cálculo a mano', () => {
    const f = okFit();
    expect(f.n).toBe(5);
    expect(f.a).toBeCloseTo(A, 10);
    expect(f.b).toBeCloseTo(B, 12);
    expect(f.r2).toBeCloseTo(R2, 10);
    expect(f.r2).toBeCloseTo(0.998934, 6);
  });

  it('a, b y R² coinciden con un método de cálculo independiente (ecuaciones normales)', () => {
    const f = okFit();
    const ind = normalEquations(REF);
    expect(f.a).toBeCloseTo(ind.a, 10);
    expect(f.b).toBeCloseTo(ind.b, 12);
    expect(f.r2).toBeCloseTo(ind.r2, 10);
  });

  it('1RM con V1RM = 0,32 m/s', () => {
    const rm = estimateOneRM(okFit(), 0.32);
    expect(rm).not.toBeNull();
    expect(rm!).toBeCloseTo(ONE_RM, 8);
    expect(rm!).toBeCloseTo(147.4074, 4);
  });

  it('1RM con V1RM = 0,16 m/s (press de banca)', () => {
    expect(estimateOneRM(okFit(), 0.16)!).toBeCloseTo((0.16 - A) / B, 8);
  });

  it('ignora pares incompletos o no positivos', () => {
    const f = linearFit([...REF, { load: null, velocity: 0.5 }, { load: 90, velocity: undefined }, { load: -5, velocity: 1 }]);
    expect(f.n).toBe(5);
    expect(f.ok && f.a).toBeCloseTo(A, 10);
  });

  it('5 cargas → sin aviso de estimación poco robusta', () => {
    expect(testWarnings(okFit(), 0.32)).toEqual([]);
  });
});

describe('percentTable · 50–80 % 1RM', () => {
  it('7 filas (50…80 en pasos del 5 %), cargas = %·1RM y velocidades sobre la recta', () => {
    const f = okFit();
    const rm = estimateOneRM(f, 0.32)!;
    const t = percentTable(f, rm);
    expect(t.map((r) => r.percent)).toEqual([50, 55, 60, 65, 70, 75, 80]);
    for (const row of t) {
      const load = (row.percent / 100) * ONE_RM;
      expect(row.load).toBeCloseTo(load, 8);
      expect(row.velocity).toBeCloseTo(A + B * load, 10);
    }
    // Comprobaciones puntuales a mano: 50 % → 73,7037 kg, 0,9170 m/s ; 80 % → 117,9259 kg, 0,5588 m/s
    expect(t[0].load).toBeCloseTo(73.7037, 4);
    expect(t[0].velocity).toBeCloseTo(0.917, 4);
    expect(t[6].load).toBeCloseTo(117.9259, 4);
    expect(t[6].velocity).toBeCloseTo(0.5588, 4);
  });

  it('vacía si no hay 1RM', () => {
    expect(percentTable(okFit(), null)).toEqual([]);
  });
});

describe('Seguimiento · diferencia respecto a la curva del pre-test', () => {
  it('referencia = a_pre + b_pre · carga', () => {
    expect(referenceVelocity(okFit(), 90)).toBeCloseTo(A + B * 90, 12); // 0,785
  });

  it('diferencia positiva con signo y valor correctos', () => {
    // ref(80) = 0,866 → 0,90 − 0,866 = +0,034
    const d = trackingDifference(okFit(), 80, 0.9)!;
    expect(d).toBeGreaterThan(0);
    expect(d).toBeCloseTo(0.034, 10);
  });

  it('diferencia negativa con signo y valor correctos', () => {
    // ref(100) = 0,704 → 0,65 − 0,704 = −0,054
    const d = trackingDifference(okFit(), 100, 0.65)!;
    expect(d).toBeLessThan(0);
    expect(d).toBeCloseTo(-0.054, 10);
  });

  it('diferencia nula cuando la velocidad coincide con la referencia', () => {
    expect(trackingDifference(okFit(), 80, 0.866)).toBeCloseTo(0, 12);
  });

  it('sin curva de pre-test válida no se calculan diferencias', () => {
    expect(trackingDifference(linearFit([{ load: 80, velocity: 0.8 }]), 80, 0.9)).toBeNull();
    expect(trackingDifference(linearFit([{ load: 40, velocity: 0.5 }, { load: 80, velocity: 0.9 }]), 80, 0.9)).toBeNull();
  });

  it('sin carga o sin velocidad de la 1.ª repetición → null', () => {
    expect(trackingDifference(okFit(), null, 0.9)).toBeNull();
    expect(trackingDifference(okFit(), 80, null)).toBeNull();
  });
});

describe('Casos límite', () => {
  it('menos de 2 puntos → no calcula', () => {
    const f0 = linearFit([]);
    const f1 = linearFit([{ load: 60, velocity: 1 }]);
    expect(f0.ok).toBe(false);
    expect(f1.ok).toBe(false);
    expect(!f1.ok && f1.reason).toBe('insufficient-points');
    expect(estimateOneRM(f1, 0.32)).toBeNull();
    expect(testWarnings(f1, 0.32)).toEqual(['insufficient-points']);
  });

  it('2 o 3 cargas → calcula con aviso de estimación poco robusta', () => {
    const f = linearFit(REF.slice(0, 3));
    expect(f.ok).toBe(true);
    expect(testWarnings(f, 0.32)).toEqual(['few-points']);
  });

  it('cargas iguales → no calcula', () => {
    const f = linearFit([{ load: 80, velocity: 0.9 }, { load: 80, velocity: 0.85 }, { load: 80, velocity: 0.8 }]);
    expect(f.ok).toBe(false);
    expect(!f.ok && f.reason).toBe('equal-loads');
    expect(estimateOneRM(f, 0.32)).toBeNull();
    expect(testWarnings(f, 0.32)).toEqual(['equal-loads']);
  });

  it('pendiente positiva → aviso, sin 1RM ni tabla', () => {
    const f = linearFit([
      { load: 40, velocity: 0.5 },
      { load: 60, velocity: 0.6 },
      { load: 80, velocity: 0.7 },
      { load: 100, velocity: 0.8 },
    ]);
    expect(f.ok).toBe(true);
    expect(f.ok && f.b).toBeGreaterThan(0);
    expect(isValidCurve(f)).toBe(false);
    expect(testWarnings(f, 0.32)).toContain('non-negative-slope');
    expect(estimateOneRM(f, 0.32)).toBeNull();
    expect(percentTable(f, estimateOneRM(f, 0.32))).toEqual([]);
  });

  it('V1RM vacío (remo tumbado sin VMAX en 1RM) → sin 1RM, sin tabla y aviso', () => {
    const f = okFit();
    for (const v of [null, undefined, Number.NaN, 0]) {
      expect(estimateOneRM(f, v)).toBeNull();
      expect(percentTable(f, estimateOneRM(f, v))).toEqual([]);
      expect(testWarnings(f, v)).toEqual(['missing-v1rm']);
    }
  });

  it('V1RM ≥ a → 1RM no positivo → null y aviso', () => {
    expect(estimateOneRM(okFit(), 1.6)).toBeNull();
    expect(testWarnings(okFit(), 1.6)).toEqual(['invalid-one-rm']);
  });
});

/* ===================== Remo tumbado: polinomio de 2.º grado con 1RM medido ===================== */

function okPoly(pts: { load: number; velocity: number }[]): PolyFitOk {
  const f = polyFit2(pts);
  if (!f.ok) throw new Error('el ajuste polinómico debería ser válido');
  return f;
}

// V = 2,0 − 0,012·L − 0,00005·L² → 1,74 1,44 1,10 0,72 0,30 en 20…100 kg
const EXACT = [
  { load: 20, velocity: 1.74 },
  { load: 40, velocity: 1.44 },
  { load: 60, velocity: 1.1 },
  { load: 80, velocity: 0.72 },
  { load: 100, velocity: 0.3 },
];

/** Método independiente: ecuaciones normales sin centrar, resueltas por la regla de Cramer. */
function cramerPoly(pts: { load: number; velocity: number }[]) {
  let n = 0, s1 = 0, s2 = 0, s3 = 0, s4 = 0, t0 = 0, t1 = 0, t2 = 0;
  for (const { load: x, velocity: y } of pts) {
    n++; s1 += x; s2 += x * x; s3 += x ** 3; s4 += x ** 4; t0 += y; t1 += x * y; t2 += x * x * y;
  }
  const det = (m: number[][]) =>
    m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
    m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
    m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
  const M = [[n, s1, s2], [s1, s2, s3], [s2, s3, s4]];
  const T = [t0, t1, t2];
  const D = det(M);
  const col = (j: number) => det(M.map((row, i) => row.map((v, k) => (k === j ? T[i] : v))));
  return { a: col(0) / D, b: col(1) / D, c: col(2) / D };
}

describe('polyFit2 · remo tumbado (VMAX)', () => {
  it('recupera exactamente un polinomio conocido (R² = 1)', () => {
    const f = okPoly(EXACT);
    expect(f.a).toBeCloseTo(2.0, 10);
    expect(f.b).toBeCloseTo(-0.012, 12);
    expect(f.c).toBeCloseTo(-0.00005, 14);
    expect(f.r2).toBeCloseTo(1, 12);
  });

  it('con 3 puntos coincide con la interpolación de Lagrange calculada a mano', () => {
    // (30; 1,85) (50; 1,45) (70; 0,95) → c = −0,000125 ; b = −0,01 ; a = 2,2625
    const f = okPoly([
      { load: 30, velocity: 1.85 },
      { load: 50, velocity: 1.45 },
      { load: 70, velocity: 0.95 },
    ]);
    expect(f.c).toBeCloseTo(-0.000125, 12);
    expect(f.b).toBeCloseTo(-0.01, 10);
    expect(f.a).toBeCloseTo(2.2625, 10);
  });

  it('con datos con ruido coincide con un método independiente (Cramer) y R² = 1 − SSres/SStot', () => {
    const pts = [
      { load: 20, velocity: 1.92 },
      { load: 30, velocity: 1.78 },
      { load: 40, velocity: 1.6 },
      { load: 50, velocity: 1.43 },
      { load: 60, velocity: 1.2 },
      { load: 70, velocity: 0.98 },
    ];
    const f = okPoly(pts);
    const ind = cramerPoly(pts);
    expect(f.a).toBeCloseTo(ind.a, 8);
    expect(f.b).toBeCloseTo(ind.b, 10);
    expect(f.c).toBeCloseTo(ind.c, 12);
    const my = pts.reduce((s, p) => s + p.velocity, 0) / pts.length;
    const ssTot = pts.reduce((s, p) => s + (p.velocity - my) ** 2, 0);
    const ssRes = pts.reduce((s, p) => s + (p.velocity - (ind.a + ind.b * p.load + ind.c * p.load ** 2)) ** 2, 0);
    expect(f.r2).toBeCloseTo(1 - ssRes / ssTot, 10);
  });

  it('coeficientes en %1RM: c1 = b·1RM/100, c2 = c·(1RM/100)²', () => {
    const f = okPoly(EXACT);
    const k = polyPercentCoefficients(f, 110);
    expect(k.c0).toBeCloseTo(2.0, 10);
    expect(k.c1).toBeCloseTo(-0.0132, 12);
    expect(k.c2).toBeCloseTo(-0.0000605, 14);
    // misma velocidad en %1RM que en kg
    expect(k.c0 + k.c1 * 50 + k.c2 * 2500).toBeCloseTo(polyAt(f, 55), 12);
  });

  it('tabla 50–80 % con 1RM medido: 7 filas, cargas = %·1RM y velocidades sobre el polinomio', () => {
    const f = okPoly(EXACT);
    const t = polyPercentTable(f, 110);
    expect(t.map((r) => r.percent)).toEqual([50, 55, 60, 65, 70, 75, 80]);
    expect(t[0].load).toBeCloseTo(55, 10);
    expect(t[0].velocity).toBeCloseTo(1.18875, 10); // 2 − 0,66 − 0,15125
    for (const r of t) {
      expect(r.load).toBeCloseTo((r.percent / 100) * 110, 10);
      expect(r.velocity).toBeCloseTo(2 - 0.012 * r.load - 0.00005 * r.load ** 2, 10);
    }
    expect(polyTestWarnings(f, 110)).toEqual([]);
  });

  it('seguimiento: referencia y diferencia con el polinomio del pre-test (no necesita 1RM)', () => {
    const f = okPoly(EXACT);
    expect(polyReferenceVelocity(f, 60)).toBeCloseTo(1.1, 10);
    expect(polyTrackingDifference(f, 60, 1.15)).toBeCloseTo(0.05, 10);
    expect(polyTrackingDifference(f, 60, 1.05)).toBeCloseTo(-0.05, 10);
    expect(polyTrackingDifference(f, null, 1.05)).toBeNull();
  });

  it('casos límite: < 3 puntos, < 3 cargas distintas, curva creciente, 1RM vacío y cargas > 1RM', () => {
    const two = polyFit2(EXACT.slice(0, 2));
    expect(two.ok).toBe(false);
    expect(polyTestWarnings(two, 110)).toEqual(['insufficient-points']);

    const dup = polyFit2([
      { load: 40, velocity: 1.4 },
      { load: 40, velocity: 1.42 },
      { load: 60, velocity: 1.1 },
      { load: 60, velocity: 1.12 },
    ]);
    expect(dup.ok).toBe(false);
    expect(polyTestWarnings(dup, 110)).toEqual(['few-distinct-loads']);

    const up = okPoly([
      { load: 20, velocity: 0.8 },
      { load: 40, velocity: 1.0 },
      { load: 60, velocity: 1.3 },
      { load: 80, velocity: 1.5 },
    ]);
    expect(isValidPolyCurve(up)).toBe(false);
    expect(polyTestWarnings(up, 100)).toContain('non-decreasing');
    expect(polyPercentTable(up, 100)).toEqual([]);
    expect(polyReferenceVelocity(up, 50)).toBeNull();

    const f = okPoly(EXACT);
    expect(polyPercentTable(f, null)).toEqual([]);
    expect(polyTestWarnings(f, null)).toEqual(['missing-one-rm']);
    expect(polyTestWarnings(f, 90)).toEqual(['load-above-one-rm']);
    expect(polyTestWarnings(okPoly(EXACT.slice(0, 3)), 110)).toEqual(['few-points']);
  });
});
