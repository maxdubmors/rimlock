import { defineConfig } from 'vitest/config';

// pnpm test:e2e: the store bundle in pinned, headless Chrome for Testing and Firefox (ADR-0017).
export default defineConfig({
  test: {
    include: ['tests/e2e/**/*.test.ts'],
    globalSetup: ['tests/e2e/global-setup.ts'],
    // Each file launches its own browsers; one file at a time keeps the machine responsive.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
