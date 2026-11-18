import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb, type DB } from '../server/db.ts';
import { createApp } from '../server/app.ts';

let db: DB;
let app: ReturnType<typeof createApp>;

beforeEach(() => {
  db = openDb(':memory:');
  app = createApp(db);
});

async function addAthlete(cycleId: number, exercise: string, name: string) {
  const r = await request(app).post(`/api/cycles/${cycleId}/exercises/${exercise}/athletes`).send({ name });
  expect(r.status).toBe(201);
  return r.body as { id: number; cycle_id: number; exercise: string; name: string };
}

async function addPoint(athleteId: number, test: string, load_kg: number | null, velocity_ms: number | null) {
  const r = await request(app).post(`/api/athletes/${athleteId}/tests/${test}/points`).send({ load_kg, velocity_ms });
  expect(r.status).toBe(201);
  return r.body as { id: number };
}

async function addSession(athleteId: number, label_or_date: string, load_kg: number, first_rep_velocity_ms: number) {
  const r = await request(app)
    .post(`/api/athletes/${athleteId}/sessions`)
    .send({ label_or_date, load_kg, first_rep_velocity_ms });
  expect(r.status).toBe(201);
  return r.body as { id: number };
}

async function detail(cycleId: number, exercise: string, athleteId: number) {
  const r = await request(app).get(`/api/cycles/${cycleId}/exercises/${exercise}/athletes/${athleteId}`);
  expect(r.status).toBe(200);
  return r.body;
}

describe('Ciclos', () => {
  it('los ciclos 1 y 2 existen al inicializar la BD', async () => {
    const r = await request(app).get('/api/cycles');
    expect(r.status).toBe(200);
    expect(r.body.map((c: { name: string }) => c.name)).toEqual(['Ciclo de entrenamiento 1', 'Ciclo de entrenamiento 2']);
  });

  it('crear nuevo ciclo numera automáticamente (3, 4…)', async () => {
    const c3 = await request(app).post('/api/cycles');
    const c4 = await request(app).post('/api/cycles');
    expect(c3.status).toBe(201);
    expect(c3.body.name).toBe('Ciclo de entrenamiento 3');
    expect(c4.body.name).toBe('Ciclo de entrenamiento 4');
    const all = await request(app).get('/api/cycles');
    expect(all.body).toHaveLength(4);
  });

  it('ciclo inexistente → 404', async () => {
    expect((await request(app).get('/api/cycles/999')).status).toBe(404);
  });
});

describe('Deportistas, puntos, parámetros y sesiones', () => {
  it('crea deportista con V1RM por defecto según el ejercicio (pre y post)', async () => {
    const s = await addAthlete(1, 'squat', 'Ana');
    const b = await addAthlete(1, 'bench', 'Ana');
    const r = await addAthlete(1, 'row', 'Ana');
    expect((await detail(1, 'squat', s.id)).tests.pre.v1rm_ms).toBe(0.32);
    expect((await detail(1, 'squat', s.id)).tests.post.v1rm_ms).toBe(0.32);
    expect((await detail(1, 'bench', b.id)).tests.pre.v1rm_ms).toBe(0.16);
    expect((await detail(1, 'row', r.id)).tests.pre.v1rm_ms).toBeNull();
    expect((await detail(1, 'row', r.id)).tests.post.v1rm_ms).toBeNull();
  });

  it('puntos: crear, editar, borrar y conservar el orden', async () => {
    const a = await addAthlete(1, 'squat', 'Ana');
    const p1 = await addPoint(a.id, 'pre', 40, 1.2);
    const p2 = await addPoint(a.id, 'pre', null, null);
    const up = await request(app).patch(`/api/athletes/${a.id}/points/${p2.id}`).send({ load_kg: 60 });
    expect(up.status).toBe(200);
    expect(up.body).toMatchObject({ load_kg: 60, velocity_ms: null });
    await request(app).patch(`/api/athletes/${a.id}/points/${p2.id}`).send({ velocity_ms: 1.02 });
    let d = await detail(1, 'squat', a.id);
    expect(d.tests.pre.points.map((p: { load_kg: number; velocity_ms: number }) => [p.load_kg, p.velocity_ms])).toEqual([
      [40, 1.2],
      [60, 1.02],
    ]);
    expect((await request(app).delete(`/api/athletes/${a.id}/points/${p1.id}`)).status).toBe(204);
    d = await detail(1, 'squat', a.id);
    expect(d.tests.pre.points).toHaveLength(1);
  });

  it('V1RM de pre y post son independientes', async () => {
    const a = await addAthlete(1, 'row', 'Ana');
    await request(app).put(`/api/athletes/${a.id}/tests/pre/params`).send({ v1rm_ms: 0.55 }).expect(200);
    let d = await detail(1, 'row', a.id);
    expect(d.tests.pre.v1rm_ms).toBe(0.55);
    expect(d.tests.post.v1rm_ms).toBeNull();
    await request(app).put(`/api/athletes/${a.id}/tests/pre/params`).send({ v1rm_ms: null }).expect(200);
    d = await detail(1, 'row', a.id);
    expect(d.tests.pre.v1rm_ms).toBeNull();
  });

  it('1RM medido (remo tumbado): se guarda por test y no borra la V1RM (actualización parcial)', async () => {
    const a = await addAthlete(1, 'row', 'Eva');
    expect((await detail(1, 'row', a.id)).tests.pre.one_rm_kg).toBeNull();
    await request(app).put(`/api/athletes/${a.id}/tests/pre/params`).send({ v1rm_ms: 0.5 }).expect(200);
    await request(app).put(`/api/athletes/${a.id}/tests/pre/params`).send({ one_rm_kg: 92.5 }).expect(200);
    await request(app).put(`/api/athletes/${a.id}/tests/post/params`).send({ one_rm_kg: 98 }).expect(200);
    const d = await detail(1, 'row', a.id);
    expect(d.tests.pre).toMatchObject({ v1rm_ms: 0.5, one_rm_kg: 92.5 });
    expect(d.tests.post).toMatchObject({ v1rm_ms: null, one_rm_kg: 98 });
    await request(app).put(`/api/athletes/${a.id}/tests/pre/params`).send({ one_rm_kg: 'x' }).expect(400);
  });

  it('migración: una BD antigua sin la columna one_rm_kg se actualiza al abrirla', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vbt-mig-'));
    const file = path.join(dir, 'old.db');
    const old = openDb(file);
    old.exec('ALTER TABLE test_params DROP COLUMN one_rm_kg');
    old.close();
    const db2 = openDb(file);
    const cols = (db2.prepare('PRAGMA table_info(test_params)').all() as Array<{ name: string }>).map((c) => c.name);
    expect(cols).toContain('one_rm_kg');
    db2.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('sesiones: crear, editar y borrar en orden de registro', async () => {
    const a = await addAthlete(1, 'bench', 'Ana');
    const s1 = await addSession(a.id, 'Sesión 1', 60, 0.8);
    await addSession(a.id, '2026-11-18', 65, 0.75);
    await request(app).patch(`/api/athletes/${a.id}/sessions/${s1.id}`).send({ first_rep_velocity_ms: 0.82 }).expect(200);
    const d = await detail(1, 'bench', a.id);
    expect(d.sessions.map((s: { label_or_date: string }) => s.label_or_date)).toEqual(['Sesión 1', '2026-11-18']);
    expect(d.sessions[0]).toMatchObject({ load_kg: 60, first_rep_velocity_ms: 0.82 });
    await request(app).delete(`/api/athletes/${a.id}/sessions/${s1.id}`).expect(204);
    expect((await detail(1, 'bench', a.id)).sessions).toHaveLength(1);
  });

  it('sesiones: guarda la velocidad de la repetición más lenta sin tocar el resto', async () => {
    const a = await addAthlete(1, 'squat', 'Ana');
    const s = await addSession(a.id, 'Sesión 1', 80, 0.9);
    expect((s as { slowest_rep_velocity_ms?: number | null }).slowest_rep_velocity_ms).toBeNull();
    await request(app).patch(`/api/athletes/${a.id}/sessions/${s.id}`).send({ slowest_rep_velocity_ms: 0.72 }).expect(200);
    const d = await detail(1, 'squat', a.id);
    expect(d.sessions[0]).toMatchObject({ load_kg: 80, first_rep_velocity_ms: 0.9, slowest_rep_velocity_ms: 0.72 });
  });

  it('migración: una BD antigua sin slowest_rep_velocity_ms se actualiza al abrirla', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vbt-mig-'));
    const file = path.join(dir, 'old.db');
    const old = openDb(file);
    old.exec('ALTER TABLE sessions DROP COLUMN slowest_rep_velocity_ms');
    old.close();
    const db2 = openDb(file);
    const cols = (db2.prepare('PRAGMA table_info(sessions)').all() as Array<{ name: string }>).map((c) => c.name);
    expect(cols).toContain('slowest_rep_velocity_ms');
    db2.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('validación: ejercicio, test, nombre y números no válidos → 400', async () => {
    await request(app).post('/api/cycles/1/exercises/deadlift/athletes').send({ name: 'X' }).expect(400);
    await request(app).post('/api/cycles/1/exercises/squat/athletes').send({ name: '  ' }).expect(400);
    const a = await addAthlete(1, 'squat', 'Ana');
    await request(app).post(`/api/athletes/${a.id}/tests/mid/points`).send({}).expect(400);
    await request(app).post(`/api/athletes/${a.id}/tests/pre/points`).send({ load_kg: 'abc' }).expect(400);
  });

  it('borrar un deportista borra en cascada puntos, parámetros y sesiones', async () => {
    const a = await addAthlete(1, 'squat', 'Ana');
    const keep = await addAthlete(1, 'squat', 'Luis');
    await addPoint(a.id, 'pre', 40, 1.2);
    await addPoint(a.id, 'post', 40, 1.25);
    await addSession(a.id, 'S1', 80, 0.85);
    await addPoint(keep.id, 'pre', 50, 1.1);
    await request(app).delete(`/api/athletes/${a.id}`).expect(204);
    const count = (t: string) =>
      (db.prepare(`SELECT COUNT(*) AS c FROM ${t} WHERE athlete_id = ?`).get(a.id) as { c: number }).c;
    expect(count('test_points')).toBe(0);
    expect(count('test_params')).toBe(0);
    expect(count('sessions')).toBe(0);
    expect((await detail(1, 'squat', keep.id)).tests.pre.points).toHaveLength(1);
  });
});

describe('Separación estricta de datos', () => {
  it('dos deportistas del mismo ejercicio y ciclo no comparten datos', async () => {
    const ana = await addAthlete(1, 'squat', 'Ana');
    const luis = await addAthlete(1, 'squat', 'Luis');
    await addPoint(ana.id, 'pre', 40, 1.2);
    await addPoint(ana.id, 'pre', 60, 1.02);
    await addPoint(luis.id, 'pre', 50, 1.1);
    await addSession(ana.id, 'S1', 80, 0.84);
    await request(app).put(`/api/athletes/${luis.id}/tests/pre/params`).send({ v1rm_ms: 0.3 }).expect(200);

    const dA = await detail(1, 'squat', ana.id);
    const dL = await detail(1, 'squat', luis.id);
    expect(dA.tests.pre.points.map((p: { load_kg: number }) => p.load_kg)).toEqual([40, 60]);
    expect(dL.tests.pre.points.map((p: { load_kg: number }) => p.load_kg)).toEqual([50]);
    expect(dA.sessions).toHaveLength(1);
    expect(dL.sessions).toHaveLength(0);
    expect(dA.tests.pre.v1rm_ms).toBe(0.32);
    expect(dL.tests.pre.v1rm_ms).toBe(0.3);
  });

  it('pre-test y post-test del mismo deportista no comparten puntos', async () => {
    const a = await addAthlete(1, 'bench', 'Ana');
    await addPoint(a.id, 'pre', 30, 1.1);
    await addPoint(a.id, 'post', 35, 1.05);
    await addPoint(a.id, 'post', 45, 0.9);
    const d = await detail(1, 'bench', a.id);
    expect(d.tests.pre.points.map((p: { load_kg: number }) => p.load_kg)).toEqual([30]);
    expect(d.tests.post.points.map((p: { load_kg: number }) => p.load_kg)).toEqual([35, 45]);
  });

  it('el mismo nombre en dos ejercicios son registros distintos sin datos compartidos', async () => {
    const sq = await addAthlete(1, 'squat', 'Ana');
    const be = await addAthlete(1, 'bench', 'Ana');
    const ro = await addAthlete(1, 'row', 'Ana');
    expect(new Set([sq.id, be.id, ro.id]).size).toBe(3);
    await addPoint(sq.id, 'pre', 100, 0.7);
    await addPoint(be.id, 'pre', 60, 0.6);
    await addSession(ro.id, 'S1', 50, 1.5);

    expect((await request(app).get('/api/cycles/1/exercises/squat/athletes')).body).toEqual([{ id: sq.id, name: 'Ana' }]);
    expect((await request(app).get('/api/cycles/1/exercises/bench/athletes')).body).toEqual([{ id: be.id, name: 'Ana' }]);
    expect((await request(app).get('/api/cycles/1/exercises/row/athletes')).body).toEqual([{ id: ro.id, name: 'Ana' }]);

    const dS = await detail(1, 'squat', sq.id);
    const dB = await detail(1, 'bench', be.id);
    const dR = await detail(1, 'row', ro.id);
    expect(dS.tests.pre.points.map((p: { load_kg: number }) => p.load_kg)).toEqual([100]);
    expect(dB.tests.pre.points.map((p: { load_kg: number }) => p.load_kg)).toEqual([60]);
    expect(dR.tests.pre.points).toHaveLength(0);
    expect(dS.sessions).toHaveLength(0);
    expect(dR.sessions).toHaveLength(1);

    // Un deportista no es accesible a través de otro ejercicio
    await request(app).get(`/api/cycles/1/exercises/bench/athletes/${sq.id}`).expect(404);
  });

  it('el mismo nombre en dos ciclos son registros distintos sin datos compartidos', async () => {
    const c1 = await addAthlete(1, 'squat', 'Ana');
    const c2 = await addAthlete(2, 'squat', 'Ana');
    expect(c1.id).not.toBe(c2.id);
    await addPoint(c1.id, 'pre', 40, 1.2);
    await addPoint(c2.id, 'pre', 90, 0.8);
    await addSession(c2.id, 'S1', 90, 0.82);

    expect((await request(app).get('/api/cycles/1/exercises/squat/athletes')).body).toEqual([{ id: c1.id, name: 'Ana' }]);
    expect((await request(app).get('/api/cycles/2/exercises/squat/athletes')).body).toEqual([{ id: c2.id, name: 'Ana' }]);
    expect((await detail(1, 'squat', c1.id)).tests.pre.points.map((p: { load_kg: number }) => p.load_kg)).toEqual([40]);
    expect((await detail(2, 'squat', c2.id)).tests.pre.points.map((p: { load_kg: number }) => p.load_kg)).toEqual([90]);
    expect((await detail(1, 'squat', c1.id)).sessions).toHaveLength(0);

    // Un deportista no es accesible a través de otro ciclo
    await request(app).get(`/api/cycles/2/exercises/squat/athletes/${c1.id}`).expect(404);

    const cy1 = await request(app).get('/api/cycles/1');
    expect(cy1.body.counts).toEqual({ squat: 1, bench: 0, row: 0 });
  });

  it('no se puede editar ni borrar un punto o sesión de otro deportista', async () => {
    const ana = await addAthlete(1, 'squat', 'Ana');
    const luis = await addAthlete(2, 'bench', 'Luis');
    const p = await addPoint(ana.id, 'pre', 40, 1.2);
    const s = await addSession(ana.id, 'S1', 80, 0.84);

    await request(app).patch(`/api/athletes/${luis.id}/points/${p.id}`).send({ load_kg: 999 }).expect(404);
    await request(app).delete(`/api/athletes/${luis.id}/points/${p.id}`).expect(404);
    await request(app).patch(`/api/athletes/${luis.id}/sessions/${s.id}`).send({ load_kg: 999 }).expect(404);
    await request(app).delete(`/api/athletes/${luis.id}/sessions/${s.id}`).expect(404);

    const d = await detail(1, 'squat', ana.id);
    expect(d.tests.pre.points[0]).toMatchObject({ load_kg: 40, velocity_ms: 1.2 });
    expect(d.sessions[0]).toMatchObject({ load_kg: 80 });
  });
});

describe('Persistencia en disco', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vbt-test-'));
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('los datos siguen disponibles al cerrar y reabrir la BD', async () => {
    const file = path.join(dir, 'vbt.db');
    const db1 = openDb(file);
    const app1 = createApp(db1);
    await request(app1).post('/api/cycles').expect(201);
    const a = (await request(app1).post('/api/cycles/3/exercises/row/athletes').send({ name: 'Eva' })).body;
    await request(app1).post(`/api/athletes/${a.id}/tests/post/points`).send({ load_kg: 50, velocity_ms: 1.4 }).expect(201);
    await request(app1).put(`/api/athletes/${a.id}/tests/post/params`).send({ v1rm_ms: 0.6 }).expect(200);
    db1.close();

    const db2 = openDb(file);
    const app2 = createApp(db2);
    const cycles = (await request(app2).get('/api/cycles')).body;
    expect(cycles.map((c: { name: string }) => c.name)).toEqual([
      'Ciclo de entrenamiento 1',
      'Ciclo de entrenamiento 2',
      'Ciclo de entrenamiento 3',
    ]);
    const d = (await request(app2).get(`/api/cycles/3/exercises/row/athletes/${a.id}`)).body;
    expect(d.name).toBe('Eva');
    expect(d.tests.post.points[0]).toMatchObject({ load_kg: 50, velocity_ms: 1.4 });
    expect(d.tests.post.v1rm_ms).toBe(0.6);
    expect(d.tests.pre.v1rm_ms).toBeNull();
    db2.close();
  });
});
