import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@glow/core': path.resolve(__dirname, './core'),
    },
  },
  test: {
    globals: true,
    include: ['test/**/*.test.ts', 'core/**/*.test.ts', 'indexer/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['core/**/*.ts', 'indexer/**/*.ts'],
      exclude: ['**/*.test.ts', '**/*.d.ts', '**/index.ts'],
    },
  },
});
