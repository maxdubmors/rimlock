import { configDefaults, defineConfig } from 'vitest/config';
import { WxtVitest } from 'wxt/testing/vitest-plugin';

// tests/manifest/ runs WXT builds, which all regenerate the same .wxt/ folder: one file at a time.
const builds = 'tests/manifest/**/*.test.ts';

export default defineConfig({
  plugins: [WxtVitest()],
  test: {
    // Browsers: pnpm test:e2e (vitest.e2e.config.ts).
    exclude: [...configDefaults.exclude, 'tests/e2e/**'],
    setupFiles: ['tests/setup.ts'],
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
          exclude: [...configDefaults.exclude, 'tests/e2e/**', builds],
        },
      },
      { extends: true, test: { name: 'builds', include: [builds], fileParallelism: false } },
    ],
  },
});
