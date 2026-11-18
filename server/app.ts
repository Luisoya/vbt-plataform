import express, { type NextFunction, type Request, type Response } from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DB } from './db.ts';
import { EXERCISES, EXERCISE_KEYS, isExerciseKey, isTestKey, type ExerciseKey, type TestKey } from '../shared/exercises.ts';

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

function intParam(v: string | string[] | undefined, name: string): number {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new HttpError(400, `Parámetro ${name} no válido`);
  return n;
}

function exerciseParam(v: string | string[] | undefined): ExerciseKey {
  if (!isExerciseKey(v)) throw new HttpError(400, 'Ejercicio no válido');
  return v;
}

function testParam(v: string | string[] | undefined): TestKey {
  if (!isTestKey(v)) throw new HttpError(400, 'Test no válido (pre o post)');
  return v;
}

/** undefined = campo ausente; null = vacío; número finito = valor. Cualquier otro valor → 400. */
function optNumber(body: Record<string, unknown>, key: string): number | null | undefined {
  if (!(key in body)) return undefined;
  const v = body[key];
  if (v === null || v === '') return null;
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  throw new HttpError(400, `Valor numérico no válido en ${key}`);
}

function optString(body: Record<string, unknown>, key: string): string | undefined {
  if (!(key in body)) return undefined;
  const v = body[key];
  if (v === null) return '';
  if (typeof v !== 'string') throw new HttpError(400, `Texto no válido en ${key}`);
  return v;
}

function bodyOf(req: Request): Record<string, unknown> {
  const b = req.body;
  return b && typeof b === 'object' && !Array.isArray(b) ? (b as Record<string, unknown>) : {};
}

interface AthleteRow {
  id: number;
  cycle_id: number;
  exercise: ExerciseKey;
  name: string;
}

export function createApp(db: DB) {
  const app = express();
  app.use(express.json());

  const q = {
    cycles: db.prepare(
      `SELECT c.id, c.name, c.created_at,
              (SELECT COUNT(*) FROM athletes a WHERE a.cycle_id = c.id) AS athlete_count
         FROM cycles c ORDER BY c.id`,
    ),
    cycle: db.prepare('SELECT id, name, created_at FROM cycles WHERE id = ?'),
    cycleCount: db.prepare('SELECT COUNT(*) AS c FROM cycles'),
    insertCycle: db.prepare('INSERT INTO cycles (name, created_at) VALUES (?, ?)'),
    countsByExercise: db.prepare('SELECT exercise, COUNT(*) AS n FROM athletes WHERE cycle_id = ? GROUP BY exercise'),
    athletesOf: db.prepare('SELECT id, name FROM athletes WHERE cycle_id = ? AND exercise = ? ORDER BY id'),
    insertAthlete: db.prepare('INSERT INTO athletes (cycle_id, exercise, name) VALUES (?, ?, ?)'),
    insertParams: db.prepare('INSERT INTO test_params (athlete_id, test, v1rm_ms, one_rm_kg) VALUES (?, ?, ?, ?)'),
    athlete: db.prepare('SELECT id, cycle_id, exercise, name FROM athletes WHERE id = ?'),
    athleteScoped: db.prepare('SELECT id, cycle_id, exercise, name FROM athletes WHERE id = ? AND cycle_id = ? AND exercise = ?'),
    deleteAthlete: db.prepare('DELETE FROM athletes WHERE id = ?'),
    points: db.prepare(
      'SELECT id, test, load_kg, velocity_ms, position FROM test_points WHERE athlete_id = ? ORDER BY position, id',
    ),
    point: db.prepare('SELECT id, test, load_kg, velocity_ms, position FROM test_points WHERE id = ? AND athlete_id = ?'),
    nextPointPos: db.prepare(
      'SELECT COALESCE(MAX(position), 0) + 1 AS p FROM test_points WHERE athlete_id = ? AND test = ?',
    ),
    insertPoint: db.prepare(
      'INSERT INTO test_points (athlete_id, test, load_kg, velocity_ms, position) VALUES (?, ?, ?, ?, ?)',
    ),
    deletePoint: db.prepare('DELETE FROM test_points WHERE id = ? AND athlete_id = ?'),
    params: db.prepare('SELECT test, v1rm_ms, one_rm_kg FROM test_params WHERE athlete_id = ?'),
    param: db.prepare('SELECT v1rm_ms, one_rm_kg FROM test_params WHERE athlete_id = ? AND test = ?'),
    upsertParams: db.prepare(
      `INSERT INTO test_params (athlete_id, test, v1rm_ms, one_rm_kg) VALUES (?, ?, ?, ?)
       ON CONFLICT (athlete_id, test) DO UPDATE SET v1rm_ms = excluded.v1rm_ms, one_rm_kg = excluded.one_rm_kg`,
    ),
    sessions: db.prepare(
      `SELECT id, label_or_date, load_kg, first_rep_velocity_ms, slowest_rep_velocity_ms, position
         FROM sessions WHERE athlete_id = ? ORDER BY position, id`,
    ),
    session: db.prepare(
      'SELECT id, label_or_date, load_kg, first_rep_velocity_ms, slowest_rep_velocity_ms, position FROM sessions WHERE id = ? AND athlete_id = ?',
    ),
    nextSessionPos: db.prepare('SELECT COALESCE(MAX(position), 0) + 1 AS p FROM sessions WHERE athlete_id = ?'),
    insertSession: db.prepare(
      'INSERT INTO sessions (athlete_id, label_or_date, load_kg, first_rep_velocity_ms, slowest_rep_velocity_ms, position) VALUES (?, ?, ?, ?, ?, ?)',
    ),
    deleteSession: db.prepare('DELETE FROM sessions WHERE id = ? AND athlete_id = ?'),
  };

  function requireCycle(id: number) {
    const c = q.cycle.get(id) as { id: number; name: string; created_at: string } | undefined;
    if (!c) throw new HttpError(404, 'Ciclo no encontrado');
    return c;
  }

  function requireAthlete(id: number): AthleteRow {
    const a = q.athlete.get(id) as AthleteRow | undefined;
    if (!a) throw new HttpError(404, 'Deportista no encontrado');
    return a;
  }

  function athleteDetail(a: AthleteRow) {
    const pts = q.points.all(a.id) as Array<{ id: number; test: TestKey; load_kg: number | null; velocity_ms: number | null; position: number }>;
    const params = q.params.all(a.id) as Array<{ test: TestKey; v1rm_ms: number | null; one_rm_kg: number | null }>;
    const test = (t: TestKey) => ({
      points: pts.filter((p) => p.test === t),
      v1rm_ms: params.find((p) => p.test === t)?.v1rm_ms ?? null,
      one_rm_kg: params.find((p) => p.test === t)?.one_rm_kg ?? null,
    });
    return { ...a, tests: { pre: test('pre'), post: test('post') }, sessions: q.sessions.all(a.id) };
  }

  /* ---------- Ciclos ---------- */
  app.get('/api/cycles', (_req, res) => {
    res.json(q.cycles.all());
  });

  app.post('/api/cycles', (_req, res) => {
    const created = db.transaction(() => {
      const { c } = q.cycleCount.get() as { c: number };
      const info = q.insertCycle.run(`Ciclo de entrenamiento ${c + 1}`, new Date().toISOString());
      return requireCycle(Number(info.lastInsertRowid));
    })();
    res.status(201).json(created);
  });

  app.get('/api/cycles/:cycleId', (req, res) => {
    const c = requireCycle(intParam(req.params.cycleId, 'cycleId'));
    const rows = q.countsByExercise.all(c.id) as Array<{ exercise: ExerciseKey; n: number }>;
    const counts = Object.fromEntries(EXERCISE_KEYS.map((k) => [k, rows.find((r) => r.exercise === k)?.n ?? 0]));
    res.json({ ...c, counts });
  });

  /* ---------- Deportistas (siempre dentro de un ciclo y un ejercicio) ---------- */
  app.get('/api/cycles/:cycleId/exercises/:exercise/athletes', (req, res) => {
    const c = requireCycle(intParam(req.params.cycleId, 'cycleId'));
    const ex = exerciseParam(req.params.exercise);
    res.json(q.athletesOf.all(c.id, ex));
  });

  app.post('/api/cycles/:cycleId/exercises/:exercise/athletes', (req, res) => {
    const c = requireCycle(intParam(req.params.cycleId, 'cycleId'));
    const ex = exerciseParam(req.params.exercise);
    const name = (optString(bodyOf(req), 'name') ?? '').trim();
    if (!name) throw new HttpError(400, 'El nombre es obligatorio');
    const a = db.transaction(() => {
      const info = q.insertAthlete.run(c.id, ex, name);
      const id = Number(info.lastInsertRowid);
      // Pre y post tienen V1RM independientes; valor por defecto según el ejercicio (null en remo tumbado).
      q.insertParams.run(id, 'pre', EXERCISES[ex].defaultV1rm, null);
      q.insertParams.run(id, 'post', EXERCISES[ex].defaultV1rm, null);
      return requireAthlete(id);
    })();
    res.status(201).json(athleteDetail(a));
  });

  app.get('/api/cycles/:cycleId/exercises/:exercise/athletes/:athleteId', (req, res) => {
    const cycleId = intParam(req.params.cycleId, 'cycleId');
    const ex = exerciseParam(req.params.exercise);
    const a = q.athleteScoped.get(intParam(req.params.athleteId, 'athleteId'), cycleId, ex) as AthleteRow | undefined;
    if (!a) throw new HttpError(404, 'Deportista no encontrado en este ciclo y ejercicio');
    res.json(athleteDetail(a));
  });

  app.delete('/api/athletes/:athleteId', (req, res) => {
    const a = requireAthlete(intParam(req.params.athleteId, 'athleteId'));
    q.deleteAthlete.run(a.id); // cascada: test_points, test_params y sessions
    res.status(204).end();
  });

  /* ---------- Puntos del test ---------- */
  app.post('/api/athletes/:athleteId/tests/:test/points', (req, res) => {
    const a = requireAthlete(intParam(req.params.athleteId, 'athleteId'));
    const test = testParam(req.params.test);
    const b = bodyOf(req);
    const load = optNumber(b, 'load_kg') ?? null;
    const vel = optNumber(b, 'velocity_ms') ?? null;
    const p = db.transaction(() => {
      const { p: pos } = q.nextPointPos.get(a.id, test) as { p: number };
      const info = q.insertPoint.run(a.id, test, load, vel, pos);
      return q.point.get(Number(info.lastInsertRowid), a.id);
    })();
    res.status(201).json(p);
  });

  app.patch('/api/athletes/:athleteId/points/:pointId', (req, res) => {
    const a = requireAthlete(intParam(req.params.athleteId, 'athleteId'));
    const id = intParam(req.params.pointId, 'pointId');
    const cur = q.point.get(id, a.id) as { load_kg: number | null; velocity_ms: number | null } | undefined;
    if (!cur) throw new HttpError(404, 'Punto no encontrado para este deportista');
    const b = bodyOf(req);
    const load = optNumber(b, 'load_kg');
    const vel = optNumber(b, 'velocity_ms');
    db.prepare('UPDATE test_points SET load_kg = ?, velocity_ms = ? WHERE id = ? AND athlete_id = ?').run(
      load === undefined ? cur.load_kg : load,
      vel === undefined ? cur.velocity_ms : vel,
      id,
      a.id,
    );
    res.json(q.point.get(id, a.id));
  });

  app.delete('/api/athletes/:athleteId/points/:pointId', (req, res) => {
    const a = requireAthlete(intParam(req.params.athleteId, 'athleteId'));
    const info = q.deletePoint.run(intParam(req.params.pointId, 'pointId'), a.id);
    if (info.changes === 0) throw new HttpError(404, 'Punto no encontrado para este deportista');
    res.status(204).end();
  });

  /* ---------- Parámetros del test (V1RM y 1RM medido); solo se modifican los campos enviados ---------- */
  app.put('/api/athletes/:athleteId/tests/:test/params', (req, res) => {
    const a = requireAthlete(intParam(req.params.athleteId, 'athleteId'));
    const test = testParam(req.params.test);
    const b = bodyOf(req);
    const v1rm = optNumber(b, 'v1rm_ms');
    const oneRm = optNumber(b, 'one_rm_kg');
    const cur = (q.param.get(a.id, test) as { v1rm_ms: number | null; one_rm_kg: number | null } | undefined) ?? {
      v1rm_ms: null,
      one_rm_kg: null,
    };
    const next = {
      v1rm_ms: v1rm === undefined ? cur.v1rm_ms : v1rm,
      one_rm_kg: oneRm === undefined ? cur.one_rm_kg : oneRm,
    };
    q.upsertParams.run(a.id, test, next.v1rm_ms, next.one_rm_kg);
    res.json({ test, ...next });
  });

  /* ---------- Sesiones de seguimiento ---------- */
  app.post('/api/athletes/:athleteId/sessions', (req, res) => {
    const a = requireAthlete(intParam(req.params.athleteId, 'athleteId'));
    const b = bodyOf(req);
    const label = optString(b, 'label_or_date') ?? '';
    const load = optNumber(b, 'load_kg') ?? null;
    const vel = optNumber(b, 'first_rep_velocity_ms') ?? null;
    const slow = optNumber(b, 'slowest_rep_velocity_ms') ?? null;
    const s = db.transaction(() => {
      const { p: pos } = q.nextSessionPos.get(a.id) as { p: number };
      const info = q.insertSession.run(a.id, label, load, vel, slow, pos);
      return q.session.get(Number(info.lastInsertRowid), a.id);
    })();
    res.status(201).json(s);
  });

  app.patch('/api/athletes/:athleteId/sessions/:sessionId', (req, res) => {
    const a = requireAthlete(intParam(req.params.athleteId, 'athleteId'));
    const id = intParam(req.params.sessionId, 'sessionId');
    const cur = q.session.get(id, a.id) as
      | { label_or_date: string; load_kg: number | null; first_rep_velocity_ms: number | null; slowest_rep_velocity_ms: number | null }
      | undefined;
    if (!cur) throw new HttpError(404, 'Sesión no encontrada para este deportista');
    const b = bodyOf(req);
    const label = optString(b, 'label_or_date');
    const load = optNumber(b, 'load_kg');
    const vel = optNumber(b, 'first_rep_velocity_ms');
    const slow = optNumber(b, 'slowest_rep_velocity_ms');
    db.prepare(
      'UPDATE sessions SET label_or_date = ?, load_kg = ?, first_rep_velocity_ms = ?, slowest_rep_velocity_ms = ? WHERE id = ? AND athlete_id = ?',
    ).run(
      label === undefined ? cur.label_or_date : label,
      load === undefined ? cur.load_kg : load,
      vel === undefined ? cur.first_rep_velocity_ms : vel,
      slow === undefined ? cur.slowest_rep_velocity_ms : slow,
      id,
      a.id,
    );
    res.json(q.session.get(id, a.id));
  });

app.delete('/api/athletes/:athleteId/sessions/:sessionId', (req, res) => {
  const a = requireAthlete(intParam(req.params.athleteId, 'athleteId'));
  const info = q.deleteSession.run(intParam(req.params.sessionId, 'sessionId'), a.id);
  if (info.changes === 0) throw new HttpError(404, 'Sesión no encontrada para este deportista');
  res.status(204).end();
});

const __dirname = path.dirname(fileURLToPath(import.meta.url));

app.use(express.static(path.join(__dirname, '..', 'dist')));

app.get('/*splat', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'dist', 'index.html'));
});

app.use('/api', (_req, _res, next) => next(new HttpError(404, 'Ruta no encontrada')));

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
    if (err instanceof SyntaxError) return res.status(400).json({ error: 'JSON no válido' });
    console.error(err);
    res.status(500).json({ error: 'Error interno del servidor' });
  });

  return app;
}
