import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    globals: false,
  },
  resolve: {
    // Allow importing worker source directly for unit tests
    alias: {
      '../src/index.js': '../src/index.ts',
    },
  },
});
