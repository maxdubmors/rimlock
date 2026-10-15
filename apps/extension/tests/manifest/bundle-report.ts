import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import type { BuildOutput } from 'wxt';

import { browsers, buildBundle } from '../build-bundle.ts';

const repositoryRoot = resolve(import.meta.dirname, '../../../..');

/**
 * Builds the store bundle for both browsers and writes, per browser, its `manifest.json` and
 * `content-modules.txt`, the modules the `content` bundle is built from: the files CI publishes so
 * that a pull request that changes them is visible (engineering.md § CI).
 */
export async function writeBundleReport(reportDir: string): Promise<void> {
  const buildDir = await mkdtemp(join(tmpdir(), 'rimlock-report-build-'));
  try {
    for (const browser of browsers) {
      const bundleDir = join(buildDir, browser);
      const output = await buildBundle(browser, 'production', bundleDir);
      const dir = join(reportDir, browser);
      await mkdir(dir, { recursive: true });
      await copyFile(join(bundleDir, 'manifest.json'), join(dir, 'manifest.json'));
      await writeFile(join(dir, 'content-modules.txt'), contentModules(output).join('\n') + '\n');
    }
  } finally {
    await rm(buildDir, { recursive: true, force: true });
  }
}

/**
 * The content bundle's modules relative to the repository root, sorted. A dependency drops pnpm's
 * store folder (`node_modules/.pnpm/<name>@<version>_<peers>/`), which changes with every bump
 * of an unrelated peer, and keeps `node_modules/<name>/<file>`.
 */
function contentModules(output: BuildOutput): string[] {
  const chunk = output.steps
    .flatMap((step) => step.chunks)
    .find((file) => file.fileName === 'content-scripts/content.js');
  if (chunk?.type !== 'chunk') throw new Error('the build has no content-scripts/content.js');
  // A virtual module's id may embed an absolute path: `\0virtual:…?/home/…/index.ts`.
  return chunk.moduleIds
    .map((id) =>
      id
        .replace(/^\0/, '')
        .replaceAll(`${repositoryRoot}/`, '')
        .replaceAll(/node_modules\/\.pnpm\/[^/]+\/node_modules\//g, 'node_modules/'),
    )
    .toSorted();
}

// pnpm build:report: node tests/manifest/bundle-report.ts <report directory>
if (import.meta.main) {
  const reportDir = process.argv[2];
  if (reportDir === undefined)
    throw new Error('usage: node tests/manifest/bundle-report.ts <directory>');
  await writeBundleReport(resolve(reportDir));
}
