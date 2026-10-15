import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { Browser as InstallableBrowser, install } from '@puppeteer/browsers';
import puppeteer, { type Browser, type Page } from 'puppeteer-core';

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

/** Downloads the pinned build once and returns the path of its executable. */
export async function installBrowser(name: BrowserName): Promise<string> {
  const installed = await install({ ...pinnedBuilds[name], cacheDir });
  return installed.executablePath;
}

/** A headless browser with the Extension installed from a bundle directory. */
export type ExtensionSession = {
  /** Opens one of the Extension's own pages, such as `popup.html`, in a new tab. */
  openPage(path: string): Promise<Page>;
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
  return {
    async openPage(path) {
      const page = await browser.newPage();
      await page.goto(`${origin}/${path}`);
      return page;
    },
    close: () => browser.close(),
  };
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
    extraPrefsFirefox: {
      'extensions.webextensions.uuids': JSON.stringify({ [geckoId]: uuid }),
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
