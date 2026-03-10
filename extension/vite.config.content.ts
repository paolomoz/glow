import { defineConfig } from 'vite';
import path from 'path';

// Separate build for the content script — must be IIFE (no ES module imports)
export default defineConfig({
  resolve: {
    alias: {
      '@glow/core': path.resolve(__dirname, '../core'),
    },
  },
  build: {
    outDir: path.resolve(__dirname, '../dist/extension'),
    emptyOutDir: false, // Don't wipe the main build output
    rollupOptions: {
      input: path.resolve(__dirname, 'content-script/index.ts'),
      output: {
        format: 'iife',
        entryFileNames: 'content-script/index.js',
        inlineDynamicImports: true,
      },
    },
    target: 'esnext',
    minify: false,
    sourcemap: true,
  },
});
