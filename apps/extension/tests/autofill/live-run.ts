// The manual live-corpus run: each page of live-corpus.json in the pinned browser with the test
// extension, FormDetector's labels on visible fields against the hand labels. How and when to run
// it: apps/extension/AGENTS.md, Autofill fixtures.

import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

import type { KeyInput, Page } from 'puppeteer-core';

import type { BrowserName } from '../build-bundle.ts';
import { installBrowser } from '../e2e/browsers.ts';
import type { ExpectedLabel, FrameDetection } from './detection.ts';
import { buildTestExtension, launchDetection } from './runner.ts';

type Step = { type?: string; text?: string; press?: string; click?: string; wait?: number };

type LivePage = {
  name: string;
  url: string;
  /** How long to let the page settle after it loads, in ms (default 2500). */
  wait?: number;
  /** A multi-step login's steps before detection; no password is ever typed. */
  steps?: Step[];
  labels: Record<string, ExpectedLabel>;
};

const args = process.argv.slice(2);
const name = args[0];
if (name !== 'chrome' && name !== 'firefox') {
  console.error('usage: live-run.ts <chrome|firefox> [--fields] [name-filter]');
  process.exit(2);
}
const browserName: BrowserName = name;
const printFields = args.includes('--fields');
const filter = args.slice(1).find((arg) => !arg.startsWith('--'));

const corpus = JSON.parse(
  await readFile(join(import.meta.dirname, 'live-corpus.json'), 'utf8'),
) as { pages: LivePage[] };
const pages = corpus.pages.filter((page) => filter === undefined || page.name.includes(filter));

/**
 * Loads the page as the prototype did: a load that never finishes still gets detected, then it
 * settles and takes its steps.
 */
async function load(page: Page, live: LivePage): Promise<string | undefined> {
  // Headless Chrome names itself in its user agent, and some sites answer that with a challenge.
  if (browserName === 'chrome') await page.setUserAgent({ userAgent });
  const warning = await page
    .goto(live.url, { waitUntil: 'networkidle2', timeout: 30_000 })
    .then(() => undefined)
    .catch((error: unknown) => String(error).split('\n')[0]);
  await sleep(live.wait ?? 2500);
  for (const step of live.steps ?? []) {
    if (step.type !== undefined) await page.locator(step.type).fill(step.text ?? '');
    if (step.press !== undefined) await page.keyboard.press(step.press as KeyInput);
    if (step.click !== undefined) await page.locator(step.click).click();
    await sleep(step.wait ?? 3000);
  }
  return warning;
}

/** Misses on visible fields as `id expected→labelled`, and labels on fields nobody can see. */
function score(
  live: LivePage,
  frames: FrameDetection[],
): { misses: string[]; invisible: string[] } {
  const labelled = new Map(frames.flatMap((frame) => frame.labels.map((l) => [l.id, l.label])));
  const fields = frames.flatMap((frame) => frame.fields);
  const misses: string[] = [];
  for (const field of fields.filter((candidate) => candidate.visible)) {
    const expected = live.labels[field.id] ?? 'none';
    const got = labelled.get(field.id) ?? 'none';
    if (got !== expected) misses.push(`${field.id} ${expected}→${got}`);
  }
  const invisible = fields
    .filter((field) => !field.visible && labelled.has(field.id))
    .map((field) => `${field.id} ${labelled.get(field.id) ?? ''}`);
  return { misses, invisible };
}

const extensionDir = await mkdtemp(join(tmpdir(), 'rimlock-autofill-live-'));
await buildTestExtension(extensionDir);
const detection = await launchDetection(
  browserName,
  await installBrowser(browserName),
  extensionDir,
);
const userAgent = (await detection.browser.userAgent()).replace('HeadlessChrome', 'Chrome');

let correct = 0;
const rows: string[] = [];
try {
  for (const live of pages) {
    let cell: string;
    try {
      let warning: string | undefined;
      const frames = await detection.detect(live.url, async (page) => {
        warning = await load(page, live);
      });
      const errors = frames.flatMap((frame) => (frame.error === undefined ? [] : [frame.error]));
      const { misses, invisible } = score(live, frames);
      if (errors.length === 0 && misses.length === 0) correct++;
      cell = [
        ...errors.map((error) => `error: ${error}`),
        ...(misses.length ? misses : ['✓']),
        ...(invisible.length ? [`on invisible fields: ${invisible.join(', ')}`] : []),
        ...(warning === undefined ? [] : [`load: ${warning}`]),
      ].join('; ');
      if (printFields)
        for (const field of frames.flatMap((frame) => frame.fields).filter((f) => f.visible))
          console.log(`${live.name} ${JSON.stringify({ ...field, expected: undefined })}`);
    } catch (error) {
      cell = `error: ${String(error).split('\n')[0] ?? ''}`;
    }
    rows.push(`| ${live.name} | ${cell} |`);
    console.error(`${live.name}: ${cell}`);
  }
} finally {
  await detection.close();
  await rm(extensionDir, { recursive: true, force: true });
}

console.log(`\n${browserName}: ${String(correct)}/${String(pages.length)} pages fully correct\n`);
console.log(['| Page | Misses (`field expected→labelled`) |', '|---|---|', ...rows].join('\n'));
