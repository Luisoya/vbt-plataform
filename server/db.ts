import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

export type DB = Database.Database;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS cycles (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT    NOT NULL,
  created_at TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS athletes (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  cycle_id INTEGER NOT NULL REFERENCES cycles(id) ON DELETE CASCADE,
  exercise TEXT    NOT NULL CHECK (exercise IN ('squat', 'bench', 'row')),
  name     TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_athletes_cycle_ex ON athletes(cycle_id, exercise);

CREATE TABLE IF NOT EXISTS test_points (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  athlete_id  INTEGER NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
  test        TEXT    NOT NULL CHECK (test IN ('pre', 'post')),
  load_kg     REAL,
  velocity_ms REAL,
  position    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_points_athlete ON test_points(athlete_id, test);

CREATE TABLE IF NOT EXISTS test_params (
  athlete_id INTEGER NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
  test       TEXT    NOT NULL CHECK (test IN ('pre', 'post')),
  v1rm_ms    REAL,
  one_rm_kg  REAL,
  PRIMARY KEY (athlete_id, test)
);

CREATE TABLE IF NOT EXISTS sessions (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  athlete_id            INTEGER NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
  label_or_date         TEXT    NOT NULL DEFAULT '',
  load_kg               REAL,
  first_rep_velocity_ms REAL,
  slowest_rep_velocity_ms REAL,
  position             INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_athlete ON sessions(athlete_id);
`;

/** Abre (o crea) la base de datos, aplica el esquema y crea los ciclos 1 y 2 si no existe ninguno. */
export function openDb(file: string): DB {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
  // Migración: 1RM medido (kg) por test, usado por el modelo polinómico del remo tumbado.
  const cols = db.prepare('PRAGMA table_info(test_params)').all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === 'one_rm_kg')) db.exec('ALTER TABLE test_params ADD COLUMN one_rm_kg REAL');
  // Migración: velocidad de la repetición más lenta de la serie (pérdida de velocidad e índice de esfuerzo).
  const sCols = db.prepare('PRAGMA table_info(sessions)').all() as Array<{ name: string }>;
  if (!sCols.some((c) => c.name === 'slowest_rep_velocity_ms')) db.exec('ALTER TABLE sessions ADD COLUMN slowest_rep_velocity_ms REAL');
  const { c } = db.prepare('SELECT COUNT(*) AS c FROM cycles').get() as { c: number };
  if (c === 0) {
    const ins = db.prepare('INSERT INTO cycles (name, created_at) VALUES (?, ?)');
    db.transaction(() => {
      ins.run('Ciclo de entrenamiento 1', new Date().toISOString());
      ins.run('Ciclo de entrenamiento 2', new Date().toISOString());
    })();
  }
  return db;
}
