import { defineConfig } from 'vitest/config';

// pnpm test:e2e: the store bundle in pinned, headless Chrome for Testing and Firefox (ADR-0017),
// the autofill fixtures, and the CoreClient contract suite on the dev-wasm Core.
/** Every folder of tests that need a browser; `pnpm test` (vitest.config.ts) leaves them out. */
export const browserTestDirs = ['tests/e2e', 'tests/autofill'];

export default defineConfig({
  test: {
    include: browserTestDirs.map((dir) => `${dir}/**/*.test.ts`),
    globalSetup: ['tests/e2e/global-setup.ts'],
    // A browser test file launches its own browsers; one file at a time keeps the machine responsive.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
