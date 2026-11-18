import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from './db.ts';
import { createApp } from './app.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const dbFile = process.env.VBT_DB_PATH ?? path.join(here, 'data', 'vbt.db');
// Variable propia (no PORT) para no colisionar con el puerto del cliente Vite.
const port = Number(process.env.API_PORT ?? 3001);

const db = openDb(dbFile);
const server = createApp(db).listen(port, () => {
  console.log(`API VBT en http://localhost:${port} · BD: ${dbFile}`);
});

function shutdown() {
  server.close();
  db.close();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
