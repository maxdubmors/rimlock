// The M0 smoke test (plan.md § M0): unlock through the walking-skeleton page, kill the
// background, and get the Database back without the Master password, timed, with no canary
// anywhere it must not be. Also the wake-up benchmark (engineering.md § Tests, Performance).

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import type { Page } from 'puppeteer-core';

import { rebuildMeasures } from '../../src/background/unlocked-state';
import type { BrowserName } from '../build-bundle';
import { launchWithExtension, type ExtensionSession } from './browsers';
import { useCanaryCheck } from './canaries';

/** CI fails above this; the real gate, 200 ms, is measured on the owner's machine (V1). */
const rebuildBudgetMs = 400;

/** The Master password `databases.json` gives `file`. */
async function masterPasswordOf(file: string): Promise<string> {
  const { fixturesDir } = inject('core');
  const databases = JSON.parse(await readFile(join(fixturesDir, 'databases.json'), 'utf8')) as {
    file: string;
    masterPassword: string | null;
  }[];
  const password = databases.find((database) => database.file === file)?.masterPassword;
  if (password == null) throw new Error(`databases.json gives ${file} no Master password`);
  return password;
}

/** Waits for the page's status line to read `text`, and fails with what it read instead. */
async function expectStatus(page: Page, text: string): Promise<void> {
  try {
    await page.waitForFunction(
      (expected) => document.querySelector('[role=status]')?.textContent === expected,
      { timeout: 20_000 },
      text,
    );
  } catch {
    expect(await page.$eval('[role=status]', (status) => status.textContent)).toBe(text);
  }
}

/** Adds `file` through the walking-skeleton page, as a user would: pick it, type, Unlock. */
async function unlockThroughPage(session: ExtensionSession, file: string): Promise<void> {
  const page = await session.openPage('welcome.html');
  await session.pickFile(page, 'input[type=file]', join(inject('core').fixturesDir, file));
  await session.type(page, 'input[type=password]', await masterPasswordOf(file));
  await session.click(page, 'button[type=submit]');
  await expectStatus(page, `Unlocked: ${nameOf(file)}`);
  await page.close();
}

function nameOf(file: string): string {
  return file === 'reference.kdbx' ? 'rimlock reference' : 'rimlock scenario';
}

/**
 * Kills the background, then asks a fresh page for the status; the page that answers was served
 * by a new background, which rebuilt the Database. Returns the rebuild's measures, in ms.
 */
async function rebuildAfterKill(session: ExtensionSession, file: string) {
  await session.stopBackground();
  const page = await session.openPage('welcome.html');
  await expectStatus(page, `Unlocked: ${nameOf(file)}`);
  await page.close();
  const measures = await session.inspectBackground((background) =>
    background.performance
      .getEntriesByType('measure')
      .map((entry) => ({ name: entry.name, duration: entry.duration })),
  );
  return Object.fromEntries(
    Object.entries(rebuildMeasures).map(([part, name]) => [
      part,
      measures.find((measure) => measure.name === name)?.duration,
    ]),
  ) as Record<keyof typeof rebuildMeasures, number | undefined>;
}

describe.each<BrowserName>(['chrome', 'firefox'])('the store bundle in %s', (name) => {
  let session: ExtensionSession;

  beforeAll(async () => {
    const { bundleDir, executablePath } = inject('e2e')[name];
    session = await launchWithExtension(name, executablePath, bundleDir);
  });

  afterAll(async () => {
    await session.close();
  });

  useCanaryCheck(() => session);

  it('rebuilds the Unlocked Database after the background is killed, without the Master password', async () => {
    await unlockThroughPage(session, 'scenario.kdbx');
    const measures = await rebuildAfterKill(session, 'scenario.kdbx');
    // Only a background that started with a Database to rebuild records the measures.
    expect(measures.total).toBeGreaterThan(0);
  });

  it(`rebuilds the reference Database within ${String(rebuildBudgetMs)} ms`, async ({
    annotate,
  }) => {
    await unlockThroughPage(session, 'reference.kdbx');
    const { total, instantiate, readLocalCopy, open } = await rebuildAfterKill(
      session,
      'reference.kdbx',
    );
    const ms = (duration: number | undefined) =>
      duration === undefined ? 'none' : `${duration.toFixed(0)} ms`;
    await annotate(
      `${name}: wake-up rebuild of the reference Database ${ms(total)} ` +
        `(WASM instantiate ${ms(instantiate)}, IndexedDB read ${ms(readLocalCopy)}, open ${ms(open)})`,
    );
    expect(total).toBeLessThanOrEqual(rebuildBudgetMs);
  }, 60_000);
});
