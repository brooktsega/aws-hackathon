// Builds each extension context separately.
// The content script must be a single self-contained classic script (no ES imports),
// so it cannot share a Rollup graph with the pages that use code-splitting.
import { build } from 'vite';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const src = resolve(root, 'src');
const outDir = resolve(root, 'dist');

const common = {
  configFile: false,
  root: src,
  publicDir: false,
  logLevel: 'warn',
};

// 1) Extension pages (side panel, dashboard): HTML entries, ES modules, shared chunks allowed.
await build({
  ...common,
  publicDir: resolve(root, 'public'),
  base: './',
  build: {
    outDir,
    emptyOutDir: true,
    modulePreload: false,
    rollupOptions: {
      input: {
        sidepanel: resolve(src, 'sidepanel/index.html'),
        dashboard: resolve(src, 'dashboard/index.html'),
      },
    },
  },
});

// 2) Service worker: single ES module file (manifest declares "type": "module").
await build({
  ...common,
  build: {
    outDir,
    emptyOutDir: false,
    lib: {
      entry: resolve(src, 'background/service-worker.ts'),
      formats: ['es'],
      fileName: () => 'background/service-worker.js',
    },
    // One self-contained file: the SDK has dynamic imports for Node-only code paths.
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
});

// 3) Content script: single IIFE, no imports at runtime.
await build({
  ...common,
  build: {
    outDir,
    emptyOutDir: false,
    lib: {
      entry: resolve(src, 'content/content.ts'),
      formats: ['iife'],
      name: 'GmailJobTrackerContent',
      fileName: () => 'content/content.js',
    },
  },
});

console.log('Built extension to', outDir);
