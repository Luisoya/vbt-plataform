import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, type CycleDTO } from '../api.ts';
import { Loading, NotFound, Shell } from '../App.tsx';
import { EXERCISES, EXERCISE_KEYS } from '../../../shared/exercises.ts';

export function CyclePage() {
  const cycleId = Number(useParams().cycleId);
  const [cycle, setCycle] = useState<CycleDTO | null | undefined>(undefined);

  useEffect(() => {
    setCycle(undefined);
    if (!Number.isInteger(cycleId) || cycleId <= 0) return setCycle(null);
    api.cycle(cycleId).then(setCycle).catch(() => setCycle(null));
  }, [cycleId]);

  if (cycle === undefined) return <Loading />;
  if (cycle === null) return <NotFound message="Ciclo no encontrado." />;

  return (
    <Shell crumbs={[{ label: cycle.name }]}>
      <h2>{cycle.name}</h2>
      <p className="sub">Selecciona un ejercicio.</p>
      <div className="grid">
        {EXERCISE_KEYS.map((k) => {
          const ex = EXERCISES[k];
          const n = cycle.counts?.[k] ?? 0;
          return (
            <Link key={k} className="tile" to={`/ciclo/${cycle.id}/${ex.slug}`}>
              <div>
                <h3>{ex.name}</h3>
                <div className="meta">
                  {n} deportista{n === 1 ? '' : 's'}
                </div>
              </div>
              <div>
                <span className="badge">{ex.velocityVariable}</span>
              </div>
            </Link>
          );
        })}
      </div>
    </Shell>
  );
}
