// The autofill fixtures (engineering.md § Tests, Autofill corpus): every synthetic and shadow-DOM
// fixture, in Chrome and Firefox, under every test host name, its FormDetector labels compared
// with the labels the fixture expects. It is the regression suite for every Proton bump.

import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { browsers } from '../build-bundle';
import { testHosts } from '../e2e/browsers';
import { serveWebPages, type WebServer } from '../e2e/web-server';
import type { FrameDetection } from './detection';
import { knownMisses } from './known-misses';
import { buildTestExtension, launchDetection, type DetectionBrowser } from './runner';

const fixturesDir = join(import.meta.dirname, 'fixtures');
const fixtures = (await readdir(fixturesDir)).filter((file) => file.endsWith('.html')).sort();
const nameOf = (file: string) => file.replace(/\.html$/, '');
/** The fixture whose login form is in a frame, from the host named after `#` if any. */
const framed = 'iframe-host.html';

let extensionDir: string;
let server: WebServer;

beforeAll(async () => {
  extensionDir = await mkdtemp(join(tmpdir(), 'rimlock-autofill-extension-'));
  await buildTestExtension(extensionDir);
  const pages: Record<string, string> = {};
  for (const file of fixtures) pages[`/${file}`] = await readFile(join(fixturesDir, file), 'utf8');
  server = await serveWebPages(pages);
});

afterAll(async () => {
  await server.close();
  await rm(extensionDir, { recursive: true, force: true });
});

/**
 * Where a fixture is loaded, with the host of each of its frames: under every test host, and
 * `iframe-host.html` also with its login frame from the other host (named after `#`), a
 * cross-origin frame.
 */
function loadsOf(file: string): { url: string; frameHosts: string[] }[] {
  const frameCount = file === framed ? 2 : 1;
  const loads = testHosts.map((host) => ({
    url: server.url(host, `/${file}`),
    frameHosts: Array<string>(frameCount).fill(host),
  }));
  if (file === framed) {
    const [first, second] = testHosts as [string, string];
    loads.push({ url: `${server.url(first, `/${file}`)}#${second}`, frameHosts: [first, second] });
  }
  return loads;
}

/** Every numbered field's label (`none` for no label), and any label on an unnumbered element. */
function detectedLabels(frames: FrameDetection[]): Record<string, string> {
  const labels: Record<string, string> = {};
  for (const frame of frames) {
    for (const field of frame.fields) labels[field.id] = 'none';
    for (const { id, label } of frame.labels) labels[id] = label;
  }
  return labels;
}

/**
 * What the fixture expects: its `data-gt` on visible fields and `none` on hidden ones, which no
 * label should land on, then the misses the baseline records.
 */
function expectedLabels(fixture: string, frames: FrameDetection[]): Record<string, string> {
  const labels: Record<string, string> = {};
  for (const frame of frames)
    for (const field of frame.fields)
      labels[field.id] = field.visible ? (field.expected ?? 'none') : 'none';
  return { ...labels, ...knownMisses[fixture] };
}

it('records misses only of fixtures it runs', () => {
  const names = fixtures.map(nameOf);
  expect(Object.keys(knownMisses).filter((fixture) => !names.includes(fixture))).toEqual([]);
});

describe.each(browsers)('%s', (name) => {
  let detection: DetectionBrowser;

  beforeAll(async () => {
    detection = await launchDetection(name, inject('e2e')[name].executablePath, extensionDir);
  });

  afterAll(async () => {
    await detection.close();
  });

  it.each(fixtures)('%s', async (file) => {
    const fixture = nameOf(file);
    for (const { url, frameHosts } of loadsOf(file)) {
      const frames = await detection.detect(url);
      expect(frames.map((frame) => frame.error).filter(Boolean), url).toEqual([]);
      expect(
        frames.map((frame) => new URL(frame.url).hostname),
        url,
      ).toEqual(frameHosts);
      expect({ url, labels: detectedLabels(frames) }).toEqual({
        url,
        labels: expectedLabels(fixture, frames),
      });
    }
  });
});
