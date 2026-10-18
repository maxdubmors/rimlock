// The harness mechanisms every end-to-end scenario relies on (verification.md V5), each shown
// working in both browsers, and the canary check shown to catch a marker in every place it dumps.

import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import type { Page } from 'puppeteer-core';

import { unlockedItem } from '../../src/background/unlocked-state';
import type { BrowserName } from '../build-bundle';
import {
  installFakeClock,
  launchWithExtension,
  testHosts,
  type ExtensionSession,
} from './browsers';
import { findLeaks, generatedCanaries, type Canary } from './canaries';
import { serveWebPages, type WebServer } from './web-server';

const clockPage = '<script>document.title = String(Date.now())</script>';

/** Runs `run` in an extension page, with the Extension's own privileges. */
async function asExtension(
  session: ExtensionSession,
  run: (arg: string) => Promise<unknown>,
  arg: string,
): Promise<void> {
  const page = await session.openPage('popup.html');
  try {
    await page.evaluate(run, arg);
  } finally {
    await page.close();
  }
}

/** The Extension API inside an evaluated function, which cannot reach this module. */
type Api = typeof import('wxt/browser').browser;

describe.each<BrowserName>(['chrome', 'firefox'])('the harness in %s', (name) => {
  let session: ExtensionSession;
  let server: WebServer;
  let canaries: Canary[];
  /** A canary no earlier test planted, so each test finds only its own. */
  const unplanted = () => {
    const canary = canaries.shift();
    if (canary === undefined) throw new Error('canaries.json has too few canaries');
    return canary;
  };

  beforeAll(async () => {
    const { bundleDir, executablePath } = inject('e2e')[name];
    session = await launchWithExtension(name, executablePath, bundleDir);
    server = await serveWebPages({ '/': '<p>A web page</p>', '/clock': clockPage });
    canaries = [...(await generatedCanaries())];
  });

  afterAll(async () => {
    await session.close();
    await server.close();
  });

  it('kills the background, and the next message starts a new one', async () => {
    const wake = async () => {
      const page = await session.openPage('popup.html');
      await page.evaluate(() => {
        const global = globalThis as unknown as { browser?: Api; chrome: Api };
        return (global.browser ?? global.chrome).runtime.sendMessage({ kind: 'status' });
      });
      await page.close();
      return session.inspectBackground((background) => background.performance.timeOrigin);
    };
    const before = await wake();
    await session.stopBackground();
    expect(await wake()).toBeGreaterThan(before);
  });

  it.each(testHosts)('serves web pages under %s', async (host) => {
    const page = await session.openWebPage(server.url(host, '/'));
    expect(await page.evaluate(() => [location.hostname, document.body.textContent])).toEqual([
      host,
      'A web page',
    ]);
    expect(server.requestedHosts).toContain(new URL(server.url(host, '/')).host);
    await page.close();
  });

  it("installs a fake clock before the page's own scripts run", async () => {
    const now = Date.UTC(2031, 0, 1);
    const page = await session.openWebPage(
      server.url(testHosts[0] ?? 'localhost', '/clock'),
      (tab) => installFakeClock(tab, now),
    );
    const seen = Number(await page.title());
    expect(seen).toBeGreaterThanOrEqual(now);
    expect(seen).toBeLessThan(now + 60_000);
    await page.close();
  });

  describe('the canary check', () => {
    const encoded = (value: string) => btoa(value);

    it.each<[string, string, (session: ExtensionSession, value: string) => Promise<unknown>]>([
      [
        'storage.local',
        'storage.local probe',
        (session, value) =>
          asExtension(
            session,
            (planted) => {
              const global = globalThis as unknown as { browser?: Api; chrome: Api };
              return (global.browser ?? global.chrome).storage.local.set({ probe: planted });
            },
            value,
          ),
      ],
      [
        'storage.session, outside the CachedKey',
        'storage.session probe',
        (session, value) =>
          asExtension(
            session,
            (planted) => {
              const global = globalThis as unknown as { browser?: Api; chrome: Api };
              return (global.browser ?? global.chrome).storage.session.set({
                probe: { note: planted },
              });
            },
            value,
          ),
      ],
      [
        'IndexedDB, as bytes',
        'IndexedDB probe/records "probe"',
        (session, value) =>
          asExtension(
            session,
            (planted) =>
              new Promise((resolve, reject) => {
                const opening = indexedDB.open('probe', 1);
                opening.onupgradeneeded = () => opening.result.createObjectStore('records');
                opening.onerror = () => {
                  reject(opening.error ?? new Error('cannot open probe'));
                };
                opening.onsuccess = () => {
                  const transaction = opening.result.transaction('records', 'readwrite');
                  transaction
                    .objectStore('records')
                    .put({ bytes: new TextEncoder().encode(planted) }, 'probe');
                  transaction.oncomplete = () => {
                    opening.result.close();
                    resolve(undefined);
                  };
                };
              }),
            value,
          ),
      ],
      [
        'a message to a content script, encoded as a Secret',
        'a message to a content script',
        async (session, value) => {
          const url = server.url('localhost', '/');
          const page = await session.openWebPage(url);
          await asExtension(
            session,
            async (message) => {
              const global = globalThis as unknown as { browser?: Api; chrome: Api };
              const api = global.browser ?? global.chrome;
              const { url: shown, secret } = JSON.parse(message) as { url: string; secret: string };
              const tab = (await api.tabs.query({})).find((candidate) => candidate.url === shown);
              await api.tabs.sendMessage(tab?.id ?? -1, { probe: { $secret: secret } });
            },
            JSON.stringify({ url, secret: encoded(value) }),
          );
          return page;
        },
      ],
      [
        "an extension page's console",
        'the console',
        (session, value) =>
          asExtension(
            session,
            (planted) => {
              console.log(planted);
              return Promise.resolve();
            },
            value,
          ),
      ],
      [
        "the background's console",
        'the console',
        (session, value) =>
          session.inspectBackground((background, planted) => {
            background.console.log(planted);
          }, value),
      ],
    ])('finds a canary planted in %s', async (_, place, plant) => {
      const canary = unplanted();
      const planted = await plant(session, canary.value);
      expect(await findLeaks(session, [canary])).toContainEqual({
        place,
        canary: `${canary.kind} of ${canary.database}`,
      });
      if (planted !== undefined) await (planted as Page).close();
    });

    it('finds the CachedKey anywhere outside its storage.session item', async () => {
      const cachedKey = encoded('cached key bytes, as opaque as the real ones');
      await asExtension(
        session,
        async (stored) => {
          const global = globalThis as unknown as { browser?: Api; chrome: Api };
          const api = global.browser ?? global.chrome;
          const { item, cachedKey: key } = JSON.parse(stored) as {
            item: string;
            cachedKey: string;
          };
          await api.storage.session.set({
            [item]: { database: 'probe', cachedKey: { $secret: key } },
          });
          await api.storage.local.set({ copied: key });
        },
        JSON.stringify({ item: unlockedItem, cachedKey }),
      );
      expect(await findLeaks(session, [])).toEqual([
        { place: 'storage.local copied', canary: 'the CachedKey' },
      ]);
    });
  });
});
