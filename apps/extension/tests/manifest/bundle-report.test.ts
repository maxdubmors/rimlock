import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { writeBundleReport } from './bundle-report';

const repositoryRoot = resolve(import.meta.dirname, '../../../..');
let reportDir: string;

beforeAll(async () => {
  reportDir = await mkdtemp(join(tmpdir(), 'rimlock-report-'));
  await writeBundleReport(reportDir);
}, 120_000);

afterAll(async () => {
  await rm(reportDir, { recursive: true, force: true });
});

describe.each(['chrome', 'firefox'])('the bundle report for %s', (browser) => {
  it('holds the built manifest.json', async () => {
    const manifest = JSON.parse(
      await readFile(join(reportDir, browser, 'manifest.json'), 'utf8'),
    ) as Record<string, unknown>;
    expect(manifest['manifest_version']).toBe(3);
    expect(manifest['name']).toBe('__MSG_extensionName__');
  });

  it('lists the modules of the content bundle, relative to the repository root', async () => {
    const modules = (await readFile(join(reportDir, browser, 'content-modules.txt'), 'utf8'))
      .trimEnd()
      .split('\n');
    expect(modules).toContain('apps/extension/src/entrypoints/content/index.ts');
    expect(modules).toEqual(modules.toSorted());
    // A dependency is named by its package, not by pnpm's store folder; every other path but a
    // bundler-generated `virtual:` module names a file in the repository.
    const dependencies = modules.filter((path) => path.startsWith('node_modules/'));
    expect(dependencies.filter((path) => path.includes('.pnpm'))).toEqual([]);
    const files = modules.filter(
      (path) => !dependencies.includes(path) && !path.startsWith('virtual:'),
    );
    await Promise.all(files.map((path) => access(join(repositoryRoot, path))));
    expect(modules.filter((path) => path.includes('src/background/'))).toEqual([]);
  });
});
