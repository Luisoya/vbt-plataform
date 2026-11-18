import { useMemo, useState } from 'react';
import { api } from '../api.ts';
import { fmt, fmtSigned, isInvalidNum, parseNum } from '../format.ts';
import { commonLoadComparison } from '../../../shared/calc.ts';
import type { ExerciseConfig, TestKey } from '../../../shared/exercises.ts';
import type { TestState } from '../pages/ExercisePage.tsx';
import { computeTest, toPoints } from '../model.ts';
import { LoadVelocityChart } from './charts.tsx';

export function TestTab(props: {
  ex: ExerciseConfig;
  athleteId: number;
  test: TestKey;
  state: TestState;
  update: (fn: (t: TestState) => TestState) => void;
  /** Solo en el post-test: datos del pre-test, para superponer su curva en el gráfico. */
  compareWith?: TestState;
}) {
  const { ex, athleteId, test, state, update, compareWith } = props;
  const vt = ex.velocityVariable;
  const label = test === 'pre' ? 'Pre-test' : 'Post-test';
  const [focusId, setFocusId] = useState<number | null>(null);

  const poly = ex.model === 'poly2';

  // Cálculo exclusivamente con los datos de ESTE test.
  const calc = useMemo(() => computeTest(ex, state), [ex, state]);
  const { table, warnings } = calc;

  // Curva del pre-test (calculada solo con sus propios datos y parámetros), para comparar visualmente.
  const refCalc = useMemo(() => (compareWith ? computeTest(ex, compareWith) : null), [ex, compareWith]);
  const reference = refCalc ? { ...refCalc.chart, label: 'Pre-test' } : undefined;

  // Cambio de velocidad en las cargas presentes en ambos tests (velocidades registradas, no la curva).
  const comparison = useMemo(
    () => (compareWith ? commonLoadComparison(toPoints(compareWith), toPoints(state)) : null),
    [compareWith, state],
  );

  async function addRow() {
    const p = await api.addPoint(athleteId, test);
    update((t) => ({ ...t, points: [...t.points, { id: p.id, load: '', vel: '' }] }));
    setFocusId(p.id);
  }

  function editRow(id: number, field: 'load' | 'vel', value: string) {
    update((t) => ({ ...t, points: t.points.map((p) => (p.id === id ? { ...p, [field]: value } : p)) }));
    api.savePoint(athleteId, id, field === 'load' ? { load_kg: parseNum(value) } : { velocity_ms: parseNum(value) });
  }

  async function removeRow(id: number) {
    await api.deletePoint(athleteId, id);
    update((t) => ({ ...t, points: t.points.filter((p) => p.id !== id) }));
  }

  function editV1rm(value: string) {
    update((t) => ({ ...t, v1rm: value }));
    api.saveV1rm(athleteId, test, parseNum(value));
  }

  function editOneRm(value: string) {
    update((t) => ({ ...t, oneRm: value }));
    api.saveOneRm(athleteId, test, parseNum(value));
  }

  return (
    <div className="two">
      <div className="card">
        <h4>Datos del {label}</h4>
        <div className="tablewrap">
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Carga (kg)</th>
                <th>{vt} (m/s)</th>
                <th aria-label="Eliminar" />
              </tr>
            </thead>
            <tbody>
              {state.points.length === 0 ? (
                <tr>
                  <td colSpan={4} className="empty" style={{ padding: 18 }}>
                    Sin datos. Añade al menos 2 pares (recomendado ≥ 4).
                  </td>
                </tr>
              ) : (
                state.points.map((p, i) => (
                  <tr key={p.id}>
                    <td className="num" style={{ color: 'var(--muted)' }}>{i + 1}</td>
                    <td>
                      <input
                        type="text"
                        inputMode="decimal"
                        aria-label={`Carga (kg) fila ${i + 1}`}
                        className={isInvalidNum(p.load) ? 'invalid' : ''}
                        value={p.load}
                        ref={(el) => {
                          if (el && focusId === p.id) {
                            el.focus();
                            setFocusId(null);
                          }
                        }}
                        onChange={(e) => editRow(p.id, 'load', e.target.value)}
                      />
                    </td>
                    <td>
                      <input
                        type="text"
                        inputMode="decimal"
                        aria-label={`${vt} (m/s) fila ${i + 1}`}
                        className={isInvalidNum(p.vel) ? 'invalid' : ''}
                        value={p.vel}
                        onChange={(e) => editRow(p.id, 'vel', e.target.value)}
                      />
                    </td>
                    <td>
                      <button className="x" title="Eliminar fila" aria-label={`Eliminar fila ${i + 1}`} onClick={() => removeRow(p.id)}>
                        ×
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <div style={{ marginTop: 10 }}>
          <button className="btn ghost" onClick={addRow}>+ Añadir par carga-velocidad</button>
        </div>
        {poly ? (
          <label className="v1rm">
            1RM medido:
            <span className="unit">
              <input type="text" inputMode="decimal" className={isInvalidNum(state.oneRm) ? 'invalid' : ''} value={state.oneRm} onChange={(e) => editOneRm(e.target.value)} placeholder="kg" />
              kg
            </span>
          </label>
        ) : (
          <label className="v1rm">
            Velocidad en el 1RM · V1RM ({vt}):
            <span className="unit">
              <input type="text" inputMode="decimal" className={isInvalidNum(state.v1rm) ? 'invalid' : ''} value={state.v1rm} onChange={(e) => editV1rm(e.target.value)} placeholder="m/s" />
              m/s
            </span>
          </label>
        )}
        <div className="note">{ex.v1rmSource}</div>
      </div>

      <div style={{ minWidth: 0 }}>
        <div className="card">
          <h4>Curva carga-velocidad · {label}</h4>
          {warnings.map((w) => (
            <div key={w} className="warn">{w}</div>
          ))}
          {calc.ok && (
            <>
              <div className="eq">{calc.equation}</div>
              <div className="stats">
                {calc.stats.map((s) => (
                  <div key={s.k} className="stat"><div className="k">{s.k}</div><div className="v">{s.v}</div></div>
                ))}
              </div>
            </>
          )}
          <div className="chartbox">
            <LoadVelocityChart curve={calc.chart} vt={vt} label={label} reference={reference} />
          </div>
          {reference && <div className="note">En gris, la curva del pre-test, para comparar con la del post-test.</div>}
        </div>

        <div className="card">
          <h4>Tabla de porcentajes 50–80 % 1RM</h4>
          {table.length > 0 ? (
            <div className="tablewrap">
              <table>
                <thead>
                  <tr>
                    <th>% RM</th>
                    <th>{vt} (m/s)</th>
                    <th>Carga equivalente (kg)</th>
                  </tr>
                </thead>
                <tbody>
                  {table.map((r) => (
                    <tr key={r.percent}>
                      <td className="num">{r.percent} %</td>
                      <td className="num">{fmt(r.velocity, 2)}</td>
                      <td className="num">{fmt(r.load, 1)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="empty" style={{ padding: 18 }}>
              {poly
                ? 'La tabla aparecerá cuando la curva sea válida y se haya introducido el 1RM medido.'
                : `La tabla aparecerá cuando la curva y la velocidad en el 1RM (${vt}) sean válidas.`}
            </div>
          )}
        </div>

        {comparison && (
          <div className="card">
            <h4>Cambio respecto al pre-test en las cargas comunes</h4>
            {comparison.length > 0 ? (
              <div className="tablewrap">
                <table>
                  <thead>
                    <tr>
                      <th>Carga común (kg)</th>
                      <th>Cambio de {vt} (m/s)</th>
                      <th>Cambio relativo (%)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {comparison.map((r) => {
                      const cls = r.diff > 0 ? 'cell-pos' : r.diff < 0 ? 'cell-neg' : '';
                      return (
                        <tr key={r.load}>
                          <td className="num">{fmt(r.load, 1)}</td>
                          <td className={`num ${cls}`} title={`Pre: ${fmt(r.pre, 3)} m/s · Post: ${fmt(r.post, 3)} m/s`}>
                            {fmtSigned(r.diff, 3)}
                          </td>
                          <td className={`num ${cls}`}>{fmtSigned(r.percent, 1)} %</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="empty" style={{ padding: 18 }}>
                No hay cargas comunes entre el pre-test y el post-test todavía.
              </div>
            )}
            <div className="note">
              Cambio = {vt} post-test − {vt} pre-test con la misma carga. Cambio relativo = cambio / {vt} pre-test · 100. Verde: mejora
              (mayor velocidad); rojo: empeora.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
