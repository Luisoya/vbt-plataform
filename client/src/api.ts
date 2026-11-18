/**
 * Cliente de la API REST con guardado automático.
 * Las ediciones se agrupan por clave (fila/campo) y se envían con un pequeño retardo.
 * Toda lectura espera antes a que se envíen los cambios pendientes, para no leer datos antiguos.
 */

export interface PointDTO { id: number; test: 'pre' | 'post'; load_kg: number | null; velocity_ms: number | null; position: number }
export interface SessionDTO { id: number; label_or_date: string; load_kg: number | null; first_rep_velocity_ms: number | null; slowest_rep_velocity_ms: number | null; position: number }
export interface TestDTO { points: PointDTO[]; v1rm_ms: number | null; one_rm_kg: number | null }
export interface AthleteDTO {
  id: number;
  cycle_id: number;
  exercise: 'squat' | 'bench' | 'row';
  name: string;
  tests: { pre: TestDTO; post: TestDTO };
  sessions: SessionDTO[];
}
export interface CycleDTO { id: number; name: string; created_at: string; athlete_count?: number; counts?: Record<string, number> }

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

type ErrorListener = (msg: string | null) => void;
const errorListeners = new Set<ErrorListener>();
export function onSaveError(fn: ErrorListener) {
  errorListeners.add(fn);
  return () => void errorListeners.delete(fn);
}
function reportError(err: unknown) {
  const msg = err instanceof Error ? err.message : String(err);
  errorListeners.forEach((fn) => fn(`No se pudo guardar: ${msg}`));
}

async function request<T>(method: string, url: string, body?: unknown, keepalive = false): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    keepalive,
  });
  if (!res.ok) {
    let msg = `${res.status}`;
    try {
      msg = (await res.json()).error ?? msg;
    } catch { /* sin cuerpo */ }
    throw new ApiError(res.status, msg);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

interface Pending { method: string; url: string; body: Record<string, unknown>; timer: ReturnType<typeof setTimeout> | null }
const pending = new Map<string, Pending>();
const inflight = new Set<Promise<unknown>>();

function track<T>(p: Promise<T>): Promise<T> {
  inflight.add(p);
  p.then(
    () => inflight.delete(p),
    () => inflight.delete(p),
  );
  return p;
}

function run(key: string, keepalive = false) {
  const e = pending.get(key);
  if (!e) return;
  pending.delete(key);
  if (e.timer) clearTimeout(e.timer);
  track(request(e.method, e.url, e.body, keepalive)).catch(reportError);
}

/** Programa un guardado (PATCH/PUT) combinando campos con la misma clave. */
export function queueSave(key: string, method: 'PATCH' | 'PUT', url: string, fields: Record<string, unknown>, delay = 300) {
  const cur = pending.get(key);
  if (cur?.timer) clearTimeout(cur.timer);
  const entry: Pending = { method, url, body: { ...(cur?.body ?? {}), ...fields }, timer: null };
  entry.timer = setTimeout(() => run(key), delay);
  pending.set(key, entry);
}

/** Envía todos los cambios pendientes y espera a que terminen. */
export async function flush() {
  for (const k of [...pending.keys()]) run(k);
  await Promise.allSettled([...inflight]);
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    for (const k of [...pending.keys()]) run(k, true);
  });
}

async function get<T>(url: string) {
  await flush();
  return request<T>('GET', url);
}
async function mutate<T>(method: string, url: string, body?: unknown) {
  await flush();
  try {
    return await track(request<T>(method, url, body));
  } catch (err) {
    reportError(err);
    throw err;
  }
}

export const api = {
  cycles: () => get<CycleDTO[]>('/api/cycles'),
  createCycle: () => mutate<CycleDTO>('POST', '/api/cycles'),
  cycle: (id: number) => get<CycleDTO>(`/api/cycles/${id}`),
  athletes: (cycleId: number, ex: string) => get<{ id: number; name: string }[]>(`/api/cycles/${cycleId}/exercises/${ex}/athletes`),
  createAthlete: (cycleId: number, ex: string, name: string) =>
    mutate<AthleteDTO>('POST', `/api/cycles/${cycleId}/exercises/${ex}/athletes`, { name }),
  athlete: (cycleId: number, ex: string, id: number) => get<AthleteDTO>(`/api/cycles/${cycleId}/exercises/${ex}/athletes/${id}`),
  deleteAthlete: (id: number) => mutate<void>('DELETE', `/api/athletes/${id}`),

  addPoint: (athleteId: number, test: string) =>
    mutate<PointDTO>('POST', `/api/athletes/${athleteId}/tests/${test}/points`, { load_kg: null, velocity_ms: null }),
  savePoint: (athleteId: number, pointId: number, fields: { load_kg?: number | null; velocity_ms?: number | null }) =>
    queueSave(`point:${pointId}`, 'PATCH', `/api/athletes/${athleteId}/points/${pointId}`, fields),
  deletePoint: (athleteId: number, pointId: number) => mutate<void>('DELETE', `/api/athletes/${athleteId}/points/${pointId}`),
  saveV1rm: (athleteId: number, test: string, v1rm_ms: number | null) =>
    queueSave(`params:${athleteId}:${test}`, 'PUT', `/api/athletes/${athleteId}/tests/${test}/params`, { v1rm_ms }),
  saveOneRm: (athleteId: number, test: string, one_rm_kg: number | null) =>
    queueSave(`params:${athleteId}:${test}`, 'PUT', `/api/athletes/${athleteId}/tests/${test}/params`, { one_rm_kg }),

  addSession: (athleteId: number, label_or_date: string) =>
    mutate<SessionDTO>('POST', `/api/athletes/${athleteId}/sessions`, { label_or_date, load_kg: null, first_rep_velocity_ms: null }),
  saveSession: (
    athleteId: number,
    sessionId: number,
    fields: {
      label_or_date?: string;
      load_kg?: number | null;
      first_rep_velocity_ms?: number | null;
      slowest_rep_velocity_ms?: number | null;
    },
  ) => queueSave(`session:${sessionId}`, 'PATCH', `/api/athletes/${athleteId}/sessions/${sessionId}`, fields),
  deleteSession: (athleteId: number, sessionId: number) => mutate<void>('DELETE', `/api/athletes/${athleteId}/sessions/${sessionId}`),
};
