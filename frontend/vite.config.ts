import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { defineConfig, loadEnv, type Plugin } from 'vite';

function offlinePos(): Plugin {
  return {
    name: 'offline-pos',
    apply: 'build',
    generateBundle: {
      order: 'post',
      handler(_options, bundle) {
        const assets = Object.keys(bundle)
          .filter((file) => file.startsWith('assets/') && !file.endsWith('.map'))
          .sort();
        const worker = readFileSync(new URL('./src/pos-offline-worker.js', import.meta.url), 'utf8');
        const version = createHash('sha256').update(JSON.stringify(assets)).update(worker).digest('hex').slice(0, 16);
        this.emitFile({
          type: 'asset',
          fileName: 'pos-offline.js',
          source: `const VERSION = ${JSON.stringify(version)};\nconst ASSETS = ${JSON.stringify(['/', ...assets.map((file) => `/${file}`)])};\n${worker}`,
        });
      },
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, import.meta.dirname, 'API_PROXY_');
  const proxy = {
    '/api/v1': { target: env.API_PROXY_TARGET || 'http://127.0.0.1:8000', changeOrigin: true },
  };

  return {
    plugins: [react(), tailwindcss(), offlinePos()],
    resolve: {
      alias: {
        '@': import.meta.dirname,
      },
    },
    server: {
      proxy,
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
    preview: { proxy },
  };
});
