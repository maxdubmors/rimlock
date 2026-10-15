import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { TestProject } from 'vitest/node';

import { buildBundle, type BrowserName } from '../build-bundle';
import { installBrowser } from './browsers';

declare module 'vitest' {
  export interface ProvidedContext {
    /** Per browser: the store bundle's directory and the pinned browser's executable. */
    e2e: Record<BrowserName, { bundleDir: string; executablePath: string }>;
  }
}

const browsers: BrowserName[] = ['chrome', 'firefox'];

/**
 * Builds the store bundle for both browsers, exactly as `pnpm build` does, with no test hooks and
 * no test build flavour (ADR-0017), and installs the pinned browsers. The Core's glue and .wasm
 * come from `pnpm build:core`, which `pnpm test:e2e` runs first.
 */
export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const outDir = await mkdtemp(join(tmpdir(), 'rimlock-e2e-'));
  const e2e = {} as Record<BrowserName, { bundleDir: string; executablePath: string }>;
  for (const name of browsers) {
    const bundleDir = join(outDir, name);
    await buildBundle(name, 'production', bundleDir);
    e2e[name] = { bundleDir, executablePath: await installBrowser(name) };
  }
  project.provide('e2e', e2e);
  return () => rm(outDir, { recursive: true, force: true });
}
