import { configDefaults, defineConfig } from 'vitest/config';
import { WxtVitest } from 'wxt/testing/vitest-plugin';

import { browserTestDirs } from './vitest.e2e.config';

// tests/manifest/ runs WXT builds, which all regenerate the same .wxt/ folder: one file at a time.
const builds = 'tests/manifest/**/*.test.ts';

// Browsers: pnpm test:e2e (vitest.e2e.config.ts).
const browserTests = browserTestDirs.map((dir) => `${dir}/**`);

export default defineConfig({
  plugins: [WxtVitest()],
  test: {
    exclude: [...configDefaults.exclude, ...browserTests],
    setupFiles: ['tests/setup.ts'],
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
          exclude: [...configDefaults.exclude, ...browserTests, builds],
        },
      },
      { extends: true, test: { name: 'builds', include: [builds], fileParallelism: false } },
    ],
  },
});
