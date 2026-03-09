import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@glow/core': path.resolve(__dirname, '../core'),
    },
  },
  build: {
    outDir: '../dist/snippet',
    emptyOutDir: true,
    lib: {
      entry: path.resolve(__dirname, 'loader.ts'),
      name: 'Glow',
      fileName: 'glow.min',
      formats: ['iife'],
    },
    target: 'es2020',
    minify: 'terser',
    sourcemap: false,
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
      },
    },
  },
});
