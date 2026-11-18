# Plataforma de monitorización de la velocidad de ejecución (VBT)

Sentadilla profunda y press de banca → **VMP** · Remo tumbado → **VMAX**.

## Requisitos

- Node.js 20 o superior (probado con Node 26).

## Instalación

```bash
npm install
```

> Con npm ≥ 11 puede aparecer un aviso de *install scripts* para `better-sqlite3` y `esbuild`.
> Si `npm run dev` falla al cargar alguno de ellos, ejecuta `npm install-scripts approve better-sqlite3 esbuild` y `npm rebuild`.

## Arranque

```bash
npm run dev
```

- Interfaz: http://localhost:5173
- API REST: http://localhost:3001/api

La base de datos SQLite se guarda en `server/data/vbt.db` (se crea con los ciclos 1 y 2 al primer arranque).
Se puede cambiar con la variable de entorno `VBT_DB_PATH` (y el puerto de la API con `API_PORT`).

## Tests

```bash
npm test
```

- `tests/calc.test.ts`: regresión, R², 1RM, tabla 50–80 %, diferencia de seguimiento y casos límite.
- `tests/api.test.ts`: API, separación de datos entre deportistas, ejercicios y ciclos, borrado en cascada y persistencia.

## Estructura

```
shared/calc.ts       Lógica de cálculo pura (curva carga-velocidad, 1RM, % 1RM, seguimiento)
shared/exercises.ts  Configuración por ejercicio (variable VMP/VMAX, V1RM por defecto y fuente)
server/              API Express + SQLite (better-sqlite3)
client/              Interfaz React + Vite + Chart.js
tests/               Vitest
```

## Rutas

`/` → `/ciclo/:cycleId` → `/ciclo/:cycleId/:ejercicio` → `/ciclo/:cycleId/:ejercicio/:athleteId/(pre-test|post-test|seguimiento)`

Ejercicios: `sentadilla-profunda`, `press-de-banca`, `remo-tumbado`.
