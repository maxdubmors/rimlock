import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

import type { TestProject } from 'vitest/node';

import { browsers, buildBundle, type BrowserName } from '../build-bundle';
import { installBrowser } from './browsers';

declare module 'vitest' {
  export interface ProvidedContext {
    /** Per browser: the store bundle's directory and the pinned browser's executable. */
    e2e: Record<BrowserName, { bundleDir: string; executablePath: string }>;
    /** The `dev-wasm` Core's glue and `.wasm`, and the test Databases with `databases.json`. */
    core: { bindingsDir: string; fixturesDir: string };
  }
}

const repository = resolve(import.meta.dirname, '../../../..');

/** Runs a build step from the repository root; its output shows only if it fails. */
async function run(command: string, args: string[]): Promise<void> {
  await promisify(execFile)(command, args, { cwd: repository, maxBuffer: 64 * 1024 * 1024 });
}

/**
 * Builds the store bundle for both browsers, exactly as `pnpm build` does, with no test hooks and
 * no test build flavour (ADR-0017), and installs the pinned browsers. The Core's glue and .wasm
 * come from `pnpm build:core`, which `pnpm test:e2e` runs first.
 *
 * For the CoreClient contract suite it also builds the `dev-wasm` Core, which has debug
 * assertions on (engineering.md § Fakes and contract suites), and generates the test Databases.
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

  const core = {
    bindingsDir: join(outDir, 'core-dev-wasm'),
    fixturesDir: join(outDir, 'fixtures'),
  };
  await run('scripts/build-core.sh', ['dev-wasm', core.bindingsDir]);
  await run('cargo', [
    'run',
    '--locked',
    '--quiet',
    '-p',
    'rimlock-core',
    '--example',
    'fixtures',
    '--',
    core.fixturesDir,
  ]);
  project.provide('core', core);

  return () => rm(outDir, { recursive: true, force: true });
}
