import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const projectRoot = fileURLToPath(new URL('..', import.meta.url));

export default defineConfig({
  root,
  plugins: [react()],
  server: {
    port: 5173,
    fs: { allow: [projectRoot] },
    proxy: { '/api': 'http://localhost:3001' },
  },
  build: { outDir: fileURLToPath(new URL('../dist', import.meta.url)), emptyOutDir: true },
});
