import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';

const heliosWebSource = fileURLToPath(new URL('./node_modules/helios-web/src/index.js', import.meta.url));

// The built app is served from the repo's map/ directory on GitHub Pages.
export default defineConfig({
  base: './',
  build: { outDir: '../map', emptyOutDir: true },
  resolve: {
    alias: {
      'helios-web': heliosWebSource,
    },
  },
  optimizeDeps: {
    exclude: ['helios-network', 'helios-web'],
  },
});
