import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type CycleDTO } from '../api.ts';
import { Loading, Shell } from '../App.tsx';

export function HomePage() {
  const [cycles, setCycles] = useState<CycleDTO[] | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.cycles().then(setCycles).catch(() => setCycles([]));
  }, []);

  async function createCycle() {
    if (busy) return;
    setBusy(true);
    try {
      await api.createCycle();
      setCycles(await api.cycles());
    } finally {
      setBusy(false);
    }
  }

  if (!cycles) return <Loading />;

  return (
    <Shell crumbs={[]}>
      <h2>Ciclos de entrenamiento</h2>
      <p className="sub">Selecciona un ciclo para acceder a sus ejercicios y deportistas.</p>
      <div className="grid">
        {cycles.map((c) => {
          const n = c.athlete_count ?? 0;
          return (
            <Link key={c.id} className="tile" to={`/ciclo/${c.id}`}>
              <div>
                <h3>{c.name}</h3>
                <div className="meta">
                  3 ejercicios · {n} deportista{n === 1 ? '' : 's'}
                </div>
              </div>
              <div>
                <span className="badge">Abrir</span>
              </div>
            </Link>
          );
        })}
        <button className="tile new" onClick={createCycle} disabled={busy}>
          <div>
            <div className="plus">+</div>
            Crear nuevo ciclo de entrenamiento
          </div>
        </button>
      </div>
    </Shell>
  );
}
