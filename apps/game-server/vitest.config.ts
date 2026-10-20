import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    setupFiles: ['./tests/setup-env.ts'],
    fileParallelism: false,
    hookTimeout: 60000,
    testTimeout: 30000,
  }
});
