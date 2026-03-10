import { defineConfig } from 'vite';
import path from 'path';

const alias = {
  '@glow/core': path.resolve(__dirname, '../core'),
};

const dist = path.resolve(__dirname, '../dist/extension');

// Single build with all entry points.
// Content script runs in a non-module context, so we need it self-contained.
// Service worker and panel run as ES modules.
export default defineConfig({
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
});
