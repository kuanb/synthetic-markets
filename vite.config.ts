import { defineConfig } from 'vite';

// GH Pages serves under /synthetic-markets/. Use root base for local dev.
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/synthetic-markets/' : '/',
  worker: {
    format: 'es',
  },
  test: {
    globals: true,
    environment: 'node',
  },
}));
