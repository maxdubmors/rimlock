import { resolve } from 'node:path';

import { build, type BuildOutput, type Logger } from 'wxt';

export type BrowserName = 'chrome' | 'firefox';
export const browsers: BrowserName[] = ['chrome', 'firefox'];

const root = resolve(import.meta.dirname, '..');

// Only errors reach the test output; WXT's progress and expected warnings would bury the results.
const ignore = (): void => undefined;
const quietLogger: Logger = {
  debug: ignore,
  log: ignore,
  info: ignore,
  success: ignore,
  warn: ignore,
  error: console.error,
  fatal: console.error,
  level: 1,
};

/**
 * Builds the Extension into `outDir` as `wxt build` does and returns WXT's account of the build;
 * `production` is the bundle that goes to the stores. Call one at a time: every WXT build
 * regenerates the same `.wxt/` folder.
 */
export async function buildBundle(
  browser: BrowserName,
  mode: 'production' | 'development',
  outDir: string,
): Promise<BuildOutput> {
  // WXT's build spinner writes to stdout directly, past the logger.
  const write = process.stdout.write.bind(process.stdout);
  process.stdout.write = () => true;
  try {
    return await build({ root, browser, mode, outDir, outDirTemplate: '.', logger: quietLogger });
  } finally {
    process.stdout.write = write;
  }
}
