import { useMemo, useState } from 'react';
import { api } from '../api.ts';
import { fmt, fmtSigned, isInvalidNum, parseNum } from '../format.ts';
import type { ExerciseConfig } from '../../../shared/exercises.ts';
import type { SessionRow, TestState } from '../pages/ExercisePage.tsx';
import { computeTest } from '../model.ts';
import { effortIndex, velocityLossPercent } from '../../../shared/calc.ts';
import { TrackingChart, type TrackingPoint } from './charts.tsx';

/** Por encima de este Índice de Esfuerzo la fila se marca en rojo. */
const EFFORT_INDEX_ALERT = 20;

export function TrackingTab(props: {
  ex: ExerciseConfig;
  athleteId: number;
  pre: TestState;
  sessions: SessionRow[];
  update: (fn: (rows: SessionRow[]) => SessionRow[]) => void;
}) {
  const { ex, athleteId, pre, sessions, update } = props;
  const vt = ex.velocityVariable;
  const [focusId, setFocusId] = useState<number | null>(null);

  // Referencia: SIEMPRE la curva del pre-test de este deportista.
  // (sentadilla y press de banca: recta; remo tumbado: polinomio de 2.º grado).
  const preCalc = useMemo(() => computeTest(ex, pre), [ex, pre]);
  const valid = preCalc.validCurve;

  const rows: (TrackingPoint & { vl: number | null; ei: number | null; slowInvalid: boolean })[] = sessions.map((s, i) => {
    const load = parseNum(s.load);
    const vel = parseNum(s.vel);
    const slow = parseNum(s.slow);
    const ref = preCalc.velocityAt(load);
    // Diferencia = velocidad 1.ª repetición − velocidad de referencia del pre-test para esa carga.
    const diff = ref != null && vel != null && vel > 0 ? vel - ref : null;
    return {
      label: s.label.trim() || `Sesión ${i + 1}`,
      load,
      vel,
      ref,
      diff,
      pct: diff != null && ref != null && ref > 0 ? (diff / ref) * 100 : null,
      // Pérdida de velocidad en la serie e Índice de Esfuerzo (Rodríguez-Rosell et al., 2018).
      vl: velocityLossPercent(vel, slow),
      ei: effortIndex(vel, slow),
      slowInvalid: vel != null && slow != null && slow > vel,
    };
  });

  async function addRow() {
    const label = `Sesión ${sessions.length + 1}`;
    const s = await api.addSession(athleteId, label);
    update((r) => [...r, { id: s.id, label, load: '', vel: '', slow: '' }]);
    setFocusId(s.id);
  }

  function edit(id: number, field: 'label' | 'load' | 'vel' | 'slow', value: string) {
    update((r) => r.map((s) => (s.id === id ? { ...s, [field]: value } : s)));
    api.saveSession(
      athleteId,
      id,
      field === 'label'
        ? { label_or_date: value }
        : field === 'load'
          ? { load_kg: parseNum(value) }
          : field === 'vel'
            ? { first_rep_velocity_ms: parseNum(value) }
            : { slowest_rep_velocity_ms: parseNum(value) },
    );
  }

  async function remove(id: number) {
    await api.deleteSession(athleteId, id);
    update((r) => r.filter((s) => s.id !== id));
  }

  const noCurve = <div className="empty" style={{ padding: 18 }}>El gráfico aparecerá cuando exista una curva de pre-test válida.</div>;

  return (
    <>
      {valid ? (
        <div className="eq">
          Referencia (pre-test): {preCalc.equation} · R² = {fmt(preCalc.r2, 4)}
        </div>
      ) : (
        <div className="warn">
          {ex.model === 'poly2'
            ? 'No hay una curva de pre-test válida (se necesitan al menos 3 cargas distintas y una curva decreciente).'
            : 'No hay una curva de pre-test válida (se necesitan al menos 2 cargas distintas y pendiente negativa).'}{' '}
          Introduce los datos del pre-test para calcular la velocidad de referencia y las diferencias.
        </div>
      )}

      <div className="card">
        <h4>Evolución de la diferencia de {vt} respecto al pre-test (m/s)</h4>
        {valid ? (
          <div className="chartbox">
            <TrackingChart points={rows} vt={vt} />
          </div>
        ) : (
          noCurve
        )}
        <div className="note">
          Diferencia = {vt} de la 1.ª repetición de la sesión − {vt} de referencia del pre-test para esa misma carga. Valores positivos: la
          carga se mueve más rápido que en la referencia inicial.
        </div>
      </div>

      <div className="card">
        <h4>Evolución de la diferencia de {vt} respecto al pre-test (%)</h4>
        {valid ? (
          <div className="chartbox">
            <TrackingChart points={rows} vt={vt} relative />
          </div>
        ) : (
          noCurve
        )}
        <div className="note">
          Diferencia relativa (%) = ({vt} de la 1.ª repetición − {vt} de referencia del pre-test) / {vt} de referencia del pre-test · 100.
        </div>
      </div>

      <div className="card">
        <h4>Sesiones de entrenamiento</h4>
        <div className="tablewrap">
          <table>
            <thead>
              <tr>
                <th>Fecha / sesión</th>
                <th>Carga absoluta (kg)</th>
                <th>{vt} 1.ª rep. (m/s)</th>
                <th>{vt} última rep. (m/s)</th>
                <th>Pérdida de velocidad (%)</th>
                <th>Índice de esfuerzo</th>
                <th>Diferencia respecto al pre-test (%)</th>
                <th>{vt} referencia pre-test (m/s)</th>
                <th aria-label="Eliminar" />
              </tr>
            </thead>
            <tbody>
              {sessions.length === 0 ? (
                <tr>
                  <td colSpan={9} className="empty" style={{ padding: 18 }}>Aún no hay sesiones registradas.</td>
                </tr>
              ) : (
                sessions.map((s, i) => {
                  const r = rows[i];
                  const alert = r.ei != null && r.ei > EFFORT_INDEX_ALERT;
                  return (
                    <tr
                      key={s.id}
                      className={alert ? 'row-alert' : undefined}
                      title={alert ? `Índice de esfuerzo superior a ${EFFORT_INDEX_ALERT}` : undefined}
                    >
                      <td>
                        <input
                          type="text"
                          aria-label={`Fecha o sesión fila ${i + 1}`}
                          value={s.label}
                          placeholder="dd/mm/aaaa o Sesión n"
                          onChange={(e) => edit(s.id, 'label', e.target.value)}
                        />
                      </td>
                      <td>
                        <input
                          type="text"
                          inputMode="decimal"
                          aria-label={`Carga absoluta (kg) fila ${i + 1}`}
                          className={isInvalidNum(s.load) ? 'invalid' : ''}
                          value={s.load}
                          ref={(el) => {
                            if (el && focusId === s.id) {
                              el.focus();
                              setFocusId(null);
                            }
                          }}
                          onChange={(e) => edit(s.id, 'load', e.target.value)}
                        />
                      </td>
                      <td>
                        <input
                          type="text"
                          inputMode="decimal"
                          aria-label={`${vt} 1.ª repetición (m/s) fila ${i + 1}`}
                          className={isInvalidNum(s.vel) ? 'invalid' : ''}
                          value={s.vel}
                          onChange={(e) => edit(s.id, 'vel', e.target.value)}
                        />
                      </td>
                      <td>
                        <input
                          type="text"
                          inputMode="decimal"
                          aria-label={`${vt} última repetición (m/s) fila ${i + 1}`}
                          title={r.slowInvalid ? 'La última repetición no puede ser más rápida que la 1.ª repetición' : undefined}
                          className={isInvalidNum(s.slow) || r.slowInvalid ? 'invalid' : ''}
                          value={s.slow}
                          onChange={(e) => edit(s.id, 'slow', e.target.value)}
                        />
                      </td>
                      <td className="num">{r.vl != null ? `${fmt(r.vl, 1)} %` : '—'}</td>
                      <td className="num">{fmt(r.ei, 1)}</td>
                      <td className="num">
                        <span className={r.pct == null ? '' : r.pct >= 0 ? 'pos' : 'neg'}>
                          {r.pct != null ? `${fmtSigned(r.pct, 1)} %` : '—'}
                        </span>
                      </td>
                      <td className="num">{fmt(r.ref, 3)}</td>
                      <td>
                        <button className="x" title="Eliminar sesión" aria-label={`Eliminar sesión ${i + 1}`} onClick={() => remove(s.id)}>
                          ×
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        <div style={{ marginTop: 10 }}>
          <button className="btn ghost" onClick={addRow}>+ Añadir sesión</button>
        </div>
        <div className="note">
          Pérdida de velocidad (%) = ({vt} 1.ª rep. − {vt} última rep.) / {vt} 1.ª rep. · 100. Índice de esfuerzo = {vt} 1.ª rep. (m/s) ×
          pérdida de velocidad (%); las filas con un índice superior a {EFFORT_INDEX_ALERT} se marcan en rojo. Rodríguez-Rosell D et al.
          (2018). Effort Index as a Novel Variable for Monitoring the Level of Effort During Resistance Exercises. J Strength Cond Res
          32(8):2139-2153.
          {ex.velocityVariable !== 'VMP' &&
            ` Nota: el índice se definió y validó con la VMP en sentadilla y press de banca; aquí se calcula con la ${vt}.`}
        </div>
      </div>
    </>
  );
}
