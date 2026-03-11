import { defineConfig } from 'vite';
import { build } from 'vite';
import path from 'path';
import { cpSync } from 'fs';

const alias = {
  '@glow/core': path.resolve(__dirname, '../core'),
};

const dist = path.resolve(__dirname, '../dist/extension');
const buildTimestamp = JSON.stringify(new Date().toISOString());

// Two-step build:
// 1. Service worker + panel as ES modules (shared chunks OK)
// 2. Content script as IIFE (must be self-contained, no imports)
export default defineConfig({
  define: {
    __BUILD_TIMESTAMP__: buildTimestamp,
  },
  resolve: { alias },
  build: {
    outDir: dist,
    emptyOutDir: true,
    rollupOptions: {
      input: {
        'background/service-worker': path.resolve(
          __dirname,
          'background/service-worker.ts',
        ),
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
  plugins: [
    {
      name: 'copy-static-files',
      closeBundle: () => {
        // Copy manifest.json, panel.html, and icons to dist
        cpSync(path.resolve(__dirname, 'manifest.json'), path.join(dist, 'manifest.json'));
        cpSync(path.resolve(__dirname, 'panel/panel.html'), path.join(dist, 'panel/panel.html'));
        cpSync(path.resolve(__dirname, 'icons'), path.join(dist, 'icons'), { recursive: true });
      },
    },
    {
      name: 'build-content-script',
      closeBundle: async () => {
        // Build content script separately as IIFE
        await build({
          define: {
            __BUILD_TIMESTAMP__: buildTimestamp,
          },
          resolve: { alias },
          build: {
            outDir: dist,
            emptyOutDir: false,
            rollupOptions: {
              input: {
                'content-script/index': path.resolve(
                  __dirname,
                  'content-script/index.ts',
                ),
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
        });
      },
    },
  ],
});
