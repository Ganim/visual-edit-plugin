import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    testTimeout: 120_000,
    hookTimeout: 60_000,
    include: ['*.test.ts'],
    // Run test files sequentially so each daemon can bind its ports without collision.
    fileParallelism: false,
  },
});
