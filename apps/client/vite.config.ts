import { defineConfig } from 'vite';

const api = process.env.STARWAKE_API ?? 'http://127.0.0.1:8787';

export default defineConfig({
  resolve: { conditions: ['source'] },
  server: {
    port: 5173,
    proxy: { '/api': api, '/healthz': api, '/readyz': api },
  },
  build: {
    target: 'es2022',
    sourcemap: true,
    chunkSizeWarningLimit: 1500,
  },
});
