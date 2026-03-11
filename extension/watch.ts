// extension/watch.ts — Watch mode: rebuilds on file changes, copies static files
import { build } from 'vite';
import { watch } from 'fs';
import { cpSync } from 'fs';
import path from 'path';

const __dirname = path.dirname(new URL(import.meta.url).pathname);
const dist = path.resolve(__dirname, '../dist/extension');
const alias = { '@glow/core': path.resolve(__dirname, '../core') };

let building = false;
let queued = false;

async function rebuild() {
  if (building) { queued = true; return; }
  building = true;
  const ts = JSON.stringify(new Date().toISOString());

  try {
    // Step 1: Service worker + panel
    await build({
      define: { __BUILD_TIMESTAMP__: ts },
      resolve: { alias },
      build: {
        outDir: dist,
        emptyOutDir: true,
        rollupOptions: {
          input: {
            'background/service-worker': path.resolve(__dirname, 'background/service-worker.ts'),
            'panel/panel': path.resolve(__dirname, 'panel/panel.ts'),
          },
          output: {
            entryFileNames: '[name].js',
            chunkFileNames: 'shared/[name].js',
            assetFileNames: 'assets/[name].[ext]',
          },
        },
        target: 'esnext',
        minify: false,
        sourcemap: true,
      },
      configFile: false,
      logLevel: 'warn',
    });

    // Step 2: Content script (IIFE)
    await build({
      define: { __BUILD_TIMESTAMP__: ts },
      resolve: { alias },
      build: {
        outDir: dist,
        emptyOutDir: false,
        rollupOptions: {
          input: {
            'content-script/index': path.resolve(__dirname, 'content-script/index.ts'),
          },
          output: {
            entryFileNames: '[name].js',
            format: 'iife',
            inlineDynamicImports: true,
          },
        },
        target: 'esnext',
        minify: false,
        sourcemap: true,
      },
      configFile: false,
      logLevel: 'warn',
    });

    // Step 3: Copy static files
    cpSync(path.resolve(__dirname, 'manifest.json'), path.resolve(dist, 'manifest.json'));
    cpSync(path.resolve(__dirname, 'icons'), path.resolve(dist, 'icons'), { recursive: true });
    cpSync(path.resolve(__dirname, 'panel/panel.html'), path.resolve(dist, 'panel/panel.html'));

    console.log(`[watch] Built at ${ts.replace(/"/g, '')} — reload page to pick up changes`);
  } catch (err) {
    console.error('[watch] Build failed:', err);
  }

  building = false;
  if (queued) { queued = false; rebuild(); }
}

// Initial build
await rebuild();

// Watch source directories using Node's built-in fs.watch (recursive)
const root = path.resolve(__dirname, '..');
const dirs = [
  path.resolve(__dirname),          // extension/
  path.resolve(__dirname, '../core'), // core/
];

for (const dir of dirs) {
  watch(dir, { recursive: true }, (event, filename) => {
    if (!filename || !filename.endsWith('.ts')) return;
    if (filename.includes('node_modules') || filename.includes('dist')) return;
    console.log(`[watch] ${event}: ${filename}`);
    rebuild();
  });
}

console.log('[watch] Watching for changes... (Ctrl+C to stop)');
