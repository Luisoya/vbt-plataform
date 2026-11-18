import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { api, type AthleteDTO, type CycleDTO } from '../api.ts';
import { Loading, NotFound, Shell, type Crumb } from '../App.tsx';
import { exerciseFromSlug, type ExerciseConfig, type TestKey } from '../../../shared/exercises.ts';
import { numToInput } from '../format.ts';
import { TestTab } from '../components/TestTab.tsx';
import { TrackingTab } from '../components/TrackingTab.tsx';

/* ---------- Estado editable de un deportista (texto tal como se escribe) ---------- */
export interface PointRow { id: number; load: string; vel: string }
export interface TestState { points: PointRow[]; v1rm: string; oneRm: string }
export interface SessionRow { id: number; label: string; load: string; vel: string; slow: string }
export interface AthleteState {
  id: number;
  name: string;
  tests: Record<TestKey, TestState>;
  sessions: SessionRow[];
}

function toState(d: AthleteDTO): AthleteState {
  const t = (k: TestKey): TestState => ({
    points: d.tests[k].points.map((p) => ({ id: p.id, load: numToInput(p.load_kg), vel: numToInput(p.velocity_ms) })),
    v1rm: numToInput(d.tests[k].v1rm_ms),
    oneRm: numToInput(d.tests[k].one_rm_kg),
  });
  return {
    id: d.id,
    name: d.name,
    tests: { pre: t('pre'), post: t('post') },
    sessions: d.sessions.map((s) => ({
      id: s.id,
      label: s.label_or_date,
      load: numToInput(s.load_kg),
      vel: numToInput(s.first_rep_velocity_ms),
      slow: numToInput(s.slowest_rep_velocity_ms),
    })),
  };
}

export const TABS = [
  { slug: 'pre-test', label: 'Pre-test' },
  { slug: 'post-test', label: 'Post-test' },
  { slug: 'seguimiento', label: 'Seguimiento del entrenamiento' },
] as const;

export function ExercisePage() {
  const params = useParams();
  const navigate = useNavigate();
  const cycleId = Number(params.cycleId);
  const ex = exerciseFromSlug(params.exercise);
  const athleteId = params.athleteId ? Number(params.athleteId) : null;
  const tab = TABS.find((t) => t.slug === params.tab);

  const [cycle, setCycle] = useState<CycleDTO | null | undefined>(undefined);
  const [athletes, setAthletes] = useState<{ id: number; name: string }[] | undefined>(undefined);
  const [newName, setNewName] = useState('');
  const [adding, setAdding] = useState(false);

  const loadList = useCallback(async () => {
    if (!ex) return;
    setAthletes(await api.athletes(cycleId, ex.key));
  }, [cycleId, ex]);

  useEffect(() => {
    setCycle(undefined);
    setAthletes(undefined);
    if (!ex || !Number.isInteger(cycleId) || cycleId <= 0) return setCycle(null);
    api
      .cycle(cycleId)
      .then(async (c) => {
        setCycle(c);
        await loadList();
      })
      .catch(() => setCycle(null));
  }, [cycleId, ex, loadList]);

  if (!ex || cycle === null) return <NotFound message="Ciclo o ejercicio no encontrado." />;
  if (cycle === undefined || athletes === undefined) return <Loading />;

  const base = `/ciclo/${cycle.id}/${ex.slug}`;
  const current = athletes.find((a) => a.id === athleteId);

  // Sin deportista seleccionado: se abre el primero.
  if (athleteId == null && athletes.length > 0) return <Navigate replace to={`${base}/${athletes[0].id}/pre-test`} />;
  if (athleteId != null && !current) return <NotFound message="Deportista no encontrado en este ciclo y ejercicio." />;
  if (current && !tab) return <Navigate replace to={`${base}/${current.id}/pre-test`} />;

  async function addAthlete() {
    const name = newName.trim();
    if (!name || adding || !ex || !cycle) return;
    setAdding(true);
    try {
      const a = await api.createAthlete(cycle.id, ex.key, name);
      setNewName('');
      await loadList();
      navigate(`${base}/${a.id}/pre-test`);
    } finally {
      setAdding(false);
    }
  }

  async function deleteAthlete(id: number, name: string) {
    if (!window.confirm(`¿Eliminar a «${name}» y todos sus datos (pre-test, post-test y seguimiento) de ${ex!.name}? Esta acción no se puede deshacer.`)) return;
    await api.deleteAthlete(id);
    await loadList();
    navigate(base, { replace: true });
  }

  const crumbs: Crumb[] = [
    { label: cycle.name, to: `/ciclo/${cycle.id}` },
    { label: ex.name, to: base },
  ];
  if (current && tab) crumbs.push({ label: current.name, to: `${base}/${current.id}/pre-test` }, { label: tab.label });

  return (
    <Shell crumbs={crumbs}>
      <h2>
        {ex.name}{' '}
        <span className="badge" style={{ verticalAlign: 'middle' }}>{ex.velocityVariable}</span>
      </h2>
      <p className="sub">
        {cycle.name} · Velocidad utilizada en este ejercicio: <b>{ex.velocityName}</b>
      </p>

      <div className="tabs" role="tablist" aria-label="Deportistas">
        {athletes.map((a) => (
          <Link
            key={a.id}
            role="tab"
            aria-selected={a.id === athleteId}
            className={`tab ${a.id === athleteId ? 'active' : ''}`}
            to={`${base}/${a.id}/${tab?.slug ?? 'pre-test'}`}
          >
            {a.name}
          </Link>
        ))}
        <form
          className="addath"
          onSubmit={(e) => {
            e.preventDefault();
            void addAthlete();
          }}
        >
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Nombre del deportista"
            aria-label="Nombre del deportista"
          />
          <button className="btn ghost" type="submit" disabled={!newName.trim() || adding}>
            + Añadir deportista
          </button>
        </form>
      </div>

      {current && tab ? (
        <AthleteView
          key={current.id}
          cycleId={cycle.id}
          ex={ex}
          athleteId={current.id}
          tabSlug={tab.slug}
          base={`${base}/${current.id}`}
          onDelete={() => deleteAthlete(current.id, current.name)}
        />
      ) : (
        <div className="card empty">Todavía no hay deportistas en este ejercicio. Añade el primero con el control superior.</div>
      )}
    </Shell>
  );
}

function AthleteView(props: {
  cycleId: number;
  ex: ExerciseConfig;
  athleteId: number;
  tabSlug: (typeof TABS)[number]['slug'];
  base: string;
  onDelete: () => void;
}) {
  const { cycleId, ex, athleteId, tabSlug, base, onDelete } = props;
  const [state, setState] = useState<AthleteState | null | undefined>(undefined);

  useEffect(() => {
    api
      .athlete(cycleId, ex.key, athleteId)
      .then((d) => setState(toState(d)))
      .catch(() => setState(null));
  }, [cycleId, ex.key, athleteId]);

  if (state === undefined) return <div className="card empty">Cargando…</div>;
  if (state === null) return <div className="card empty">No se pudieron cargar los datos del deportista.</div>;

  const setS = setState as Dispatch<SetStateAction<AthleteState>>;
  const setTest = (k: TestKey) => (fn: (t: TestState) => TestState) =>
    setS((s) => ({ ...s, tests: { ...s.tests, [k]: fn(s.tests[k]) } }));
  const setSessions = (fn: (rows: SessionRow[]) => SessionRow[]) => setS((s) => ({ ...s, sessions: fn(s.sessions) }));

  return (
    <>
      <div className="subtabs-row">
        <div className="subtabs" role="tablist" aria-label="Pestañas del deportista">
          {TABS.map((t) => (
            <Link key={t.slug} role="tab" aria-selected={t.slug === tabSlug} className={`subtab ${t.slug === tabSlug ? 'active' : ''}`} to={`${base}/${t.slug}`}>
              {t.label}
            </Link>
          ))}
        </div>
        <button className="btn danger" onClick={onDelete}>Eliminar deportista</button>
      </div>
      {tabSlug === 'pre-test' && <TestTab key="pre" ex={ex} athleteId={athleteId} test="pre" state={state.tests.pre} update={setTest('pre')} />}
      {tabSlug === 'post-test' && <TestTab key="post" ex={ex} athleteId={athleteId} test="post" state={state.tests.post} update={setTest('post')} compareWith={state.tests.pre} />}
      {tabSlug === 'seguimiento' && (
        <TrackingTab ex={ex} athleteId={athleteId} pre={state.tests.pre} sessions={state.sessions} update={setSessions} />
      )}
    </>
  );
}
