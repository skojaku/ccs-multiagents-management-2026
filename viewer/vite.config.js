import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';

const heliosWebSource = fileURLToPath(new URL('./node_modules/helios-web/src/index.js', import.meta.url));

// The built app is served from the repo's map/ directory on GitHub Pages.
export default defineConfig({
  base: './',
  build: {
    outDir: '../map',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        hierarchy: fileURLToPath(new URL('./hierarchy/index.html', import.meta.url)),
      },
    },
  },
  resolve: {
    alias: {
      'helios-web': heliosWebSource,
    },
  },
  optimizeDeps: {
    exclude: ['helios-network', 'helios-web'],
  },
});
