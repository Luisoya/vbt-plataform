import { Fragment, useEffect, useState, type ReactNode } from 'react';
import { Link, Route, Routes } from 'react-router-dom';
import { onSaveError } from './api.ts';
import { HomePage } from './pages/HomePage.tsx';
import { CyclePage } from './pages/CyclePage.tsx';
import { ExercisePage } from './pages/ExercisePage.tsx';

export interface Crumb {
  label: string;
  to?: string;
}

/** Cabecera con migas de pan + contenido de la página. */
export function Shell({ crumbs, children }: { crumbs: Crumb[]; children: ReactNode }) {
  const [error, setError] = useState<string | null>(null);
  useEffect(() => onSaveError(setError), []);
  const all: Crumb[] = [{ label: 'Inicio', to: '/' }, ...crumbs];
  return (
    <>
      <header>
        <Link className="logo" to="/" aria-label="Inicio">
          <img src="/logo.svg" alt="" width={48} height={48} />
        </Link>
        <h1>Visor de rendimiento</h1>
        <nav className="crumbs" aria-label="Migas de pan">
          {all.map((c, i) => (
            <Fragment key={i}>
              {i > 0 && <span aria-hidden>›</span>}
              {c.to && i < all.length - 1 ? <Link to={c.to}>{c.label}</Link> : <span>{c.label}</span>}
            </Fragment>
          ))}
        </nav>
      </header>
      <main>
        {error && (
          <div className="error" role="alert">
            {error}{' '}
            <button className="x" onClick={() => setError(null)} aria-label="Cerrar">×</button>
          </div>
        )}
        {children}
      </main>
    </>
  );
}

export function NotFound({ message = 'Página no encontrada.' }: { message?: string }) {
  return (
    <Shell crumbs={[]}>
      <div className="card empty">
        {message} <Link to="/">Volver al inicio</Link>
      </div>
    </Shell>
  );
}

export function Loading({ crumbs = [] }: { crumbs?: Crumb[] }) {
  return (
    <Shell crumbs={crumbs}>
      <div className="card empty">Cargando…</div>
    </Shell>
  );
}

export function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/ciclo/:cycleId" element={<CyclePage />} />
      <Route path="/ciclo/:cycleId/:exercise" element={<ExercisePage />} />
      <Route path="/ciclo/:cycleId/:exercise/:athleteId" element={<ExercisePage />} />
      <Route path="/ciclo/:cycleId/:exercise/:athleteId/:tab" element={<ExercisePage />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
