import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

import { Browser as InstallableBrowser, install } from '@puppeteer/browsers';
import puppeteer, {
  type Browser,
  type ElementHandle,
  type JSHandle,
  type Page,
  type Target,
  TargetType,
} from 'puppeteer-core';

import type { BrowserName } from '../build-bundle';

/**
 * The browsers the end-to-end tests run in: the builds puppeteer-core's own release is tested
 * against (`puppeteer-core/lib/puppeteer/revisions.js`). Bump them together with puppeteer-core.
 */
const pinnedBuilds: Record<BrowserName, { browser: InstallableBrowser; buildId: string }> = {
  chrome: { browser: InstallableBrowser.CHROME, buildId: '155.0.8059.39' },
  firefox: { browser: InstallableBrowser.FIREFOX, buildId: 'stable_157.0.1' },
};

// Puppeteer's own default, so the browsers are shared with any other checkout.
const cacheDir = process.env['PUPPETEER_CACHE_DIR'] ?? join(homedir(), '.cache', 'puppeteer');

/** Host names both browsers resolve to 127.0.0.1, for web pages served by `serveWebPages`. */
export const testHosts = ['a.rimlock.test', 'b.rimlock.test'];

/**
 * How long the Firefox event page lives without events (`extensions.background.idle.timeout`),
 * so `stopBackground` can wait it out. The default is 30 s.
 */
const firefoxBackgroundIdleMs = 2000;

/**
 * Where a content script's isolated world keeps the messages it received, once
 * `openWebPage` has started recording them. The page's own scripts cannot see that world.
 */
const recordedMessages = 'rimlockTestReceivedMessages';

/** Downloads the pinned build once and returns the path of its executable. */
export async function installBrowser(name: BrowserName): Promise<string> {
  const installed = await install({ ...pinnedBuilds[name], cacheDir });
  return installed.executablePath;
}

/** A headless browser with the Extension installed from a bundle directory. */
export type ExtensionSession = {
  name: BrowserName;
  /** Opens one of the Extension's own pages, such as `popup.html`, in a new tab. */
  openPage(path: string): Promise<Page>;
  /**
   * Type, click and pick a file in one of the Extension's own pages, as a user would. Firefox's
   * WebDriver BiDi input module fails on extension pages (`input.performActions` and
   * `input.setFiles` on moz-extension:// pages), so there they are DOM events, which carry no
   * user activation.
   */
  type(page: Page, selector: string, text: string): Promise<void>;
  click(page: Page, selector: string): Promise<void>;
  pickFile(page: Page, selector: string, path: string): Promise<void>;
  /**
   * Opens a web page and records every message the Extension sends to its content scripts there
   * (`tabs.sendMessage`, `tabs.connect`), for `receivedMessages`. `prepare` runs on the new tab
   * before it loads, to install a fake clock, say.
   */
  openWebPage(url: string, prepare?: (page: Page) => Promise<void>): Promise<Page>;
  /** What the content scripts of every open web page received, one JSON text per frame. */
  receivedMessages(): Promise<string[]>;
  /**
   * Kills the background as the browser does when it is idle. Chrome: stops the service worker
   * over CDP. Firefox: waits out the short idle timeout this session's profile sets.
   */
  stopBackground(): Promise<void>;
  /**
   * Runs `inspect` on the background's global object, as a debugger would, to read what the
   * background observes about itself (its `performance` entries), with `arg` passed along. Wakes
   * the background in Firefox, not in Chrome. Never use it to change the Extension's state
   * (ADR-0017).
   */
  inspectBackground<T>(
    inspect: (background: typeof globalThis, arg: string) => T,
    arg?: string,
  ): Promise<T>;
  /** Everything the browser and the Extension wrote to the console since the launch. */
  consoleOutput(): Promise<string>;
  close(): Promise<void>;
};

export async function launchWithExtension(
  name: BrowserName,
  executablePath: string,
  bundleDir: string,
): Promise<ExtensionSession> {
  const { browser, origin } =
    name === 'chrome'
      ? await launchChrome(executablePath, bundleDir)
      : await launchFirefox(executablePath, bundleDir);
  const output: string[] = [];
  const browserProcess = browser.process();
  browserProcess?.stdout?.on('data', (chunk: Buffer) => output.push(chunk.toString()));
  browserProcess?.stderr?.on('data', (chunk: Buffer) => output.push(chunk.toString()));

  async function openPage(path: string): Promise<Page> {
    const page = await browser.newPage();
    const url = `${origin}/${path}`;
    if (name === 'chrome') await page.goto(url);
    else await openInFirefox(page, url);
    return page;
  }

  /** Runs `run` in a fresh extension page, with the Extension's own privileges. */
  async function asExtension<T>(run: (args: string[]) => Promise<T>, args: string[]): Promise<T> {
    const page = await openPage('popup.html');
    try {
      return await page.evaluate(run, args);
    } finally {
      await page.close();
    }
  }

  /** Chrome's background: the Extension's service worker. */
  const isBackgroundWorker = (target: Target) =>
    target.type() === TargetType.SERVICE_WORKER && target.url().startsWith(origin);

  async function element(page: Page, selector: string) {
    const found = await page.$(selector);
    if (found === null) throw new Error(`${page.url()} has no ${selector}`);
    return found;
  }

  return {
    name,
    openPage,
    async type(page, selector, text) {
      const input = await element(page, selector);
      if (name === 'chrome') {
        await input.type(text);
        return;
      }
      await input.evaluate((field, value) => {
        if (!(field instanceof HTMLInputElement)) throw new Error('not an input');
        field.value = value;
        field.dispatchEvent(new Event('input', { bubbles: true }));
      }, text);
    },
    async click(page, selector) {
      const target = await element(page, selector);
      if (name === 'chrome') await target.click();
      else
        await target.evaluate((clicked) => {
          if (clicked instanceof HTMLElement) clicked.click();
        });
    },
    async pickFile(page, selector, path) {
      const input = await element(page, selector);
      if (name === 'chrome') {
        await (input as ElementHandle<HTMLInputElement>).uploadFile(path);
        return;
      }
      // What a pick leaves behind: a File in input.files, then a change event.
      await input.evaluate(
        (field, base64, fileName) => {
          if (!(field instanceof HTMLInputElement)) throw new Error('not an input');
          const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
          const transfer = new DataTransfer();
          transfer.items.add(new File([bytes], fileName));
          field.files = transfer.files;
          field.dispatchEvent(new Event('change', { bubbles: true }));
        },
        (await readFile(path)).toString('base64'),
        basename(path),
      );
    },
    async openWebPage(url, prepare) {
      const page = await browser.newPage();
      await prepare?.(page);
      await page.goto(url);
      await asExtension(startRecordingMessages, [url, recordedMessages]);
      return page;
    },
    receivedMessages: () => asExtension(readRecordedMessages, [recordedMessages]),
    async stopBackground() {
      if (name === 'firefox') {
        await sleep(firefoxBackgroundIdleMs + 1000);
        return;
      }
      await (await browser.targets().find(isBackgroundWorker)?.worker())?.close();
      while (browser.targets().some(isBackgroundWorker)) await sleep(50);
    },
    async inspectBackground<T>(
      inspect: (background: typeof globalThis, arg: string) => T,
      arg = '',
    ): Promise<T> {
      if (name === 'chrome') {
        const target = await browser.waitForTarget(isBackgroundWorker);
        const worker = await target.worker();
        if (worker === null) throw new Error('the background has no worker');
        const global = await worker.evaluateHandle(() => globalThis);
        return await worker.evaluate(inspect, global, arg);
      }
      const page = await openPage('popup.html');
      try {
        const background = (await page.evaluateHandle(() => {
          const global = globalThis as unknown as { browser: ExtensionApi };
          // eslint-disable-next-line @typescript-eslint/no-deprecated -- Chrome's types; Firefox's event page is a page, and this is the way into it
          return global.browser.runtime.getBackgroundPage();
        })) as unknown as JSHandle<typeof globalThis>;
        return await page.evaluate(inspect, background, arg);
      } finally {
        await page.close();
      }
    },
    async consoleOutput() {
      // Console lines arrive asynchronously: wait for one logged after everything before it.
      const marker = `rimlock console flush ${randomUUID()}`;
      await asExtension(
        (lines) => {
          lines.forEach((line) => {
            console.log(line);
          });
          return Promise.resolve();
        },
        [marker],
      );
      for (let waited = 0; !output.join('').includes(marker); waited += 50) {
        if (waited > 5000) throw new Error(`${name} printed no console output`);
        await sleep(50);
      }
      return output.join('');
    },
    close: () => browser.close(),
  };
}

/**
 * Makes `page` start at `now`, as a Unix time in milliseconds: installed before any of the page's
 * own scripts run, on every load. `Date` moves on from there at the real pace.
 */
export async function installFakeClock(page: Page, now: number): Promise<void> {
  await page.evaluateOnNewDocument((start: number) => {
    const RealDate = Date;
    const offset = start - RealDate.now();
    class FakeDate extends RealDate {
      constructor(...args: [] | [string | number | Date]) {
        if (args.length === 0) super(RealDate.now() + offset);
        else super(args[0]);
      }

      static override now(): number {
        return RealDate.now() + offset;
      }
    }
    globalThis.Date = FakeDate as DateConstructor;
  }, now);
}

/**
 * The Extension API in a page an evaluated function runs in: `browser` in Firefox, `chrome` in
 * Chrome. An evaluated function is serialised on its own, so it reaches the API itself.
 */
type ExtensionApi = typeof import('wxt/browser').browser;

/**
 * Evaluated in an extension page: adds listeners to the content-script world of every frame of
 * the tab showing `url`, where the Extension's content scripts receive their messages.
 */
async function startRecordingMessages([url, recordedMessages]: string[]): Promise<void> {
  const global = globalThis as unknown as { browser?: ExtensionApi; chrome: ExtensionApi };
  const api = global.browser ?? global.chrome;
  const tab = (await api.tabs.query({})).find((candidate) => candidate.url === url);
  if (tab?.id === undefined) throw new Error(`no tab shows ${String(url)}`);
  await api.scripting.executeScript({
    target: { tabId: tab.id, allFrames: true },
    args: [recordedMessages ?? ''],
    func: (key: string) => {
      const world = globalThis as unknown as Record<string, unknown[]> & {
        browser?: ExtensionApi;
        chrome: ExtensionApi;
      };
      const received: unknown[] = (world[key] ??= []);
      const extension = world.browser ?? world.chrome;
      extension.runtime.onMessage.addListener((message: unknown) => {
        received.push(message);
        return undefined;
      });
      extension.runtime.onConnect.addListener((port) => {
        port.onMessage.addListener((message: unknown) => received.push(message));
      });
    },
  });
}

/** Evaluated in an extension page: what every web page's content scripts recorded. */
async function readRecordedMessages([recordedMessages]: string[]): Promise<string[]> {
  const global = globalThis as unknown as { browser?: ExtensionApi; chrome: ExtensionApi };
  const api = global.browser ?? global.chrome;
  const tabs = (await api.tabs.query({})).filter((tab) => /^https?:/.test(tab.url ?? ''));
  const frames = await Promise.all(
    tabs.map((tab) =>
      api.scripting.executeScript({
        target: { tabId: tab.id ?? -1, allFrames: true },
        args: [recordedMessages ?? ''],
        func: (key: string) => JSON.stringify((globalThis as Record<string, unknown>)[key] ?? []),
      }),
    ),
  );
  return frames.flat().map((frame) => String(frame.result));
}

/**
 * Firefox loads an extension page but never reports the navigation to WebDriver BiDi as done,
 * so `goto` would time out: wait for the page itself instead. A wait that starts before the
 * navigation runs in the document it replaces, and fails with it: wait again in the new one.
 */
async function openInFirefox(page: Page, url: string): Promise<void> {
  void page.goto(url).catch(() => undefined);
  const giveUpAt = Date.now() + 10_000;
  for (;;) {
    try {
      await page.waitForFunction(
        (expected) => location.href === expected && document.readyState === 'complete',
        { timeout: Math.max(giveUpAt - Date.now(), 1) },
        url,
      );
      return;
    } catch (error) {
      if (Date.now() >= giveUpAt) throw error;
      await sleep(50);
    }
  }
}

async function launchChrome(
  executablePath: string,
  bundleDir: string,
): Promise<{ browser: Browser; origin: string }> {
  // Chrome installs unpacked extensions only over a pipe, not a WebSocket.
  const browser = await puppeteer.launch({
    executablePath,
    headless: true,
    enableExtensions: true,
    pipe: true,
    args: [
      // Every console message, the service worker's included, goes to stderr.
      '--enable-logging=stderr',
      '--v=0',
      // The test hosts reach the local web server directly, whatever the machine's proxy is.
      '--no-proxy-server',
      `--host-resolver-rules=${testHosts.map((host) => `MAP ${host} 127.0.0.1`).join(',')}`,
    ],
  });
  const id = await browser.installExtension(bundleDir);
  return { browser, origin: `chrome-extension://${id}` };
}

async function launchFirefox(
  executablePath: string,
  bundleDir: string,
): Promise<{ browser: Browser; origin: string }> {
  // Firefox gives every install a random moz-extension:// host; this pref fixes it in advance.
  const geckoId = await readGeckoId(bundleDir);
  const uuid = randomUUID();
  const browser = await puppeteer.launch({
    browser: 'firefox',
    executablePath,
    headless: true,
    enableExtensions: true,
    // WebDriver BiDi navigates only to http(s), file and blob URLs without it, so it could not
    // open the Extension's pages. A flag of the test browser; the bundle stays as shipped.
    args: ['--remote-allow-system-access'],
    extraPrefsFirefox: {
      'extensions.webextensions.uuids': JSON.stringify({ [geckoId]: uuid }),
      'extensions.background.idle.timeout': firefoxBackgroundIdleMs,
      // Every console message, the event page's included, goes to stdout.
      'devtools.console.stdout.content': true,
      'network.dns.localDomains': testHosts.join(','),
      // The test hosts reach the local web server directly, whatever the machine's proxy is.
      'network.proxy.type': 0,
    },
  });
  await browser.installExtension(bundleDir);
  return { browser, origin: `moz-extension://${uuid}` };
}

async function readGeckoId(bundleDir: string): Promise<string> {
  const manifest = JSON.parse(await readFile(join(bundleDir, 'manifest.json'), 'utf8')) as {
    browser_specific_settings?: { gecko?: { id?: string } };
  };
  const id = manifest.browser_specific_settings?.gecko?.id;
  if (id === undefined) throw new Error(`${bundleDir}/manifest.json names no gecko.id`);
  return id;
}
