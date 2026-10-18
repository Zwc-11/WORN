import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';

/**
 * @decartai/sdk starts a Web Worker with new URL('./frame-metadata-worker.js', import.meta.url) and,
 * in Chromium, pipes every outgoing video frame through it. Vite pre-bundles the SDK into
 * node_modules/.vite/deps/, where that file does not exist: the worker 404s, frames are encoded but
 * 0 bytes are sent, and Decart never starts generating (measured Oct 17, all SDK versions).
 * This serves the SDK's own worker file at whatever path the bundled SDK asks for.
 * (Production builds are fine: Rollup copies the worker as an asset.)
 */
function decartFrameMetadataWorker(): Plugin {
  const require = createRequire(import.meta.url);
  const workerFile = () => resolve(dirname(require.resolve('@decartai/sdk/package.json')), 'dist/realtime/browser/frame-metadata-worker.js');
  return {
    name: 'worn:decart-frame-metadata-worker',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url || !/\/frame-metadata-worker\.js(\?|$)/.test(req.url)) return next();
        res.setHeader('Content-Type', 'text/javascript');
        res.setHeader('Cache-Control', 'no-cache');
        res.end(readFileSync(workerFile()));
      });
    },
  };
}

// /api/* goes to the token server (server/, port 8787) so the Decart key never reaches the browser.
export default defineConfig({
  plugins: [react(), decartFrameMetadataWorker()],
  server: {
    port: 5173,
    proxy: { '/api': { target: `http://localhost:${process.env.API_PORT ?? 8787}`, changeOrigin: false } },
  },
  build: {
    rollupOptions: {
      input: {
        index: resolve(__dirname, 'index.html'),
        lab: resolve(__dirname, 'lab.html'),
        stage: resolve(__dirname, 'stage.html'),
      },
    },
  },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
} as never);
