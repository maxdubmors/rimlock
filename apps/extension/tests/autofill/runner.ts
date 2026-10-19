import { copyFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { Browser, Page } from 'puppeteer-core';
import { build } from 'rolldown';

import type { BrowserName } from '../build-bundle.ts';
import { launchBrowser } from '../e2e/browsers.ts';
import {
  detectRequestEvent,
  detectReplyEvent,
  type DetectRequest,
  type FrameDetection,
} from './detection.ts';

const extensionSource = join(import.meta.dirname, 'extension');

/**
 * Builds the test extension into `outDir`: the Extension's FormDetector in a content script of
 * its own. A field's label never leaves the store bundle's content script, so the runner observes
 * FormDetector here instead (ADR-0017).
 */
export async function buildTestExtension(outDir: string): Promise<void> {
  await build({
    input: join(extensionSource, 'content.ts'),
    platform: 'browser',
    logLevel: 'warn',
    output: { file: join(outDir, 'content.js'), format: 'iife' },
  });
  await copyFile(join(extensionSource, 'manifest.json'), join(outDir, 'manifest.json'));
}

export type DetectionBrowser = {
  /**
   * Opens a fresh tab, has `load` bring the page to where detection should run, and returns what
   * FormDetector found there in each http(s) frame, the top frame first. By default `load` goes
   * to `url` and waits for the load event; a live page may also need to settle, or a step of a
   * multi-step login taken.
   */
  detect(url: string, load?: (page: Page) => Promise<void>): Promise<FrameDetection[]>;
  browser: Browser;
  close(): Promise<void>;
};

/** The pinned browser, headless, with the test extension in `extensionDir` installed. */
export async function launchDetection(
  name: BrowserName,
  executablePath: string,
  extensionDir: string,
): Promise<DetectionBrowser> {
  const { browser } = await launchBrowser(name, executablePath, extensionDir);
  return {
    browser,
    async detect(
      url,
      load = (page) => page.goto(url, { waitUntil: 'load' }).then(() => undefined),
    ) {
      const page = await browser.newPage();
      try {
        // The prototype's viewport: what is visible, and so what is scored, depends on it.
        await page.setViewport({ width: 1280, height: 900 });
        await load(page);
        const frames = page.frames().filter((frame) => /^https?:/.test(frame.url()));
        const detections: FrameDetection[] = [];
        for (const [index, frame] of frames.entries()) {
          const request: DetectRequest = { frameKey: `f${String(index)}` };
          const reply = await frame.evaluate(
            ask,
            JSON.stringify(request),
            detectRequestEvent,
            detectReplyEvent,
          );
          detections.push(JSON.parse(reply) as FrameDetection);
        }
        return detections;
      } finally {
        await page.close();
      }
    },
    close: () => browser.close(),
  };
}

/**
 * Evaluated in a frame's own world: asks the content script for a detection and waits for the
 * reply. The content script may not be listening yet, so the request repeats until it answers.
 */
function ask(
  request: string,
  detectRequestEvent: string,
  detectReplyEvent: string,
): Promise<string> {
  return new Promise((resolve) => {
    const giveUp = setTimeout(() => {
      clearInterval(repeat);
      resolve(
        JSON.stringify({
          url: location.href,
          fields: [],
          labels: [],
          error: 'the content script never answered',
        }),
      );
    }, 10_000);
    const send = () =>
      document.dispatchEvent(new CustomEvent(detectRequestEvent, { detail: request }));
    const repeat = setInterval(send, 100);
    document.addEventListener(
      detectReplyEvent,
      (event) => {
        clearTimeout(giveUp);
        clearInterval(repeat);
        resolve(String((event as CustomEvent<unknown>).detail));
      },
      { once: true },
    );
    send();
  });
}
