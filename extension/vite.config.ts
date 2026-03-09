import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@glow/core': path.resolve(__dirname, '../core'),
    },
  },
  build: {
    outDir: '../dist/extension',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        'background/service-worker': path.resolve(
          __dirname,
          'background/service-worker.ts',
        ),
        'content-script/index': path.resolve(
          __dirname,
          'content-script/index.ts',
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
