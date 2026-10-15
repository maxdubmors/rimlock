import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import type { Request, ResponseTo } from '../../src/protocol/messages';
import type { BrowserName } from '../build-bundle';
import { launchWithExtension, type ExtensionSession } from './browsers';

/** The version the Core is built with, read from the workspace manifest, not from the build. */
async function workspaceVersion(): Promise<string> {
  const manifest = await readFile(resolve(import.meta.dirname, '../../../../Cargo.toml'), 'utf8');
  const version = /\[workspace\.package\][^[]*?^version = "([^"]+)"/m.exec(manifest)?.[1];
  if (version === undefined) throw new Error('Cargo.toml has no [workspace.package] version');
  return version;
}

describe.each<BrowserName>(['chrome', 'firefox'])('the background in %s', (name) => {
  let session: ExtensionSession;

  beforeAll(async () => {
    const { bundleDir, executablePath } = inject('e2e')[name];
    session = await launchWithExtension(name, executablePath, bundleDir);
  });

  afterAll(async () => {
    await session.close();
  });

  // V2: the .wasm loads in the Chrome service worker and the Firefox event page under the CSP.
  it('runs the Core and answers a status request with its version', async () => {
    const page = await session.openPage('popup.html');
    const request: Request = { kind: 'status' };
    const response = await page.evaluate(
      (message) =>
        (
          globalThis as unknown as {
            chrome: { runtime: { sendMessage(message: unknown): Promise<unknown> } };
          }
        ).chrome.runtime.sendMessage(message),
      request,
    );
    expect(response).toEqual({
      core: 'running',
      version: await workspaceVersion(),
    } satisfies ResponseTo<typeof request>);
  });
});
