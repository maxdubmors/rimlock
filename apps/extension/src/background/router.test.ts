import { describe, expect, it, vi } from 'vitest';
import { browser, type Browser } from 'wxt/browser';
import { fakeBrowser } from 'wxt/testing/fake-browser';

import { encodeRequest } from '../protocol/messages';

import { Secret } from '../shared/secret';
import { CoreClient, type CoreBindings } from './core-client';
import { FakeCore, fakeDatabase } from './fake-core';
import { answer, startRouter, type Background } from './router';
import { rebuildMeasures, UnlockedState } from './unlocked-state';

const masterPassword = 'correct horse';
const file = fakeDatabase({ name: 'Scenario', masterPassword });

/**
 * A background as it starts: a new Core over the storage the last one left. `core` stands in for
 * the bindings, `FakeCore` by default.
 */
function startBackground(core: CoreBindings = new FakeCore()): Background {
  const client = new CoreClient(() => Promise.resolve(core));
  return { core: client, unlocked: new UnlockedState(client) };
}

/** A background whose Core cannot be instantiated. */
function startBackgroundWithoutCore(): Background {
  const client = new CoreClient(() => Promise.reject(new Error('no WebAssembly')));
  return { core: client, unlocked: new UnlockedState(client) };
}

function unlock(background: Background, bytes = file, password = masterPassword) {
  return answer(
    { kind: 'unlock', file: bytes, masterPassword: Secret.fromText(password) },
    background,
  );
}

describe('the status request', () => {
  it('reports the version of the running Core and no Unlocked Database', async () => {
    expect(await answer({ kind: 'status' }, startBackground())).toEqual({
      core: 'running',
      version: 'fake',
      unlocked: null,
    });
  });

  it('reports the Core unavailable when it cannot be instantiated, instead of never answering', async () => {
    expect(await answer({ kind: 'status' }, startBackgroundWithoutCore())).toEqual({
      core: 'unavailable',
    });
  });
});

describe('the unlock request', () => {
  it('answers the name of the Database it unlocked', async () => {
    expect(await unlock(startBackground())).toEqual({ unlocked: true, name: 'Scenario' });
  });

  it('makes it the Unlocked Database', async () => {
    const background = startBackground();
    await unlock(background);
    expect(await answer({ kind: 'status' }, background)).toMatchObject({
      unlocked: { name: 'Scenario' },
    });
  });

  it('replaces the Database Unlocked before, since at most one is (ADR-0015)', async () => {
    const background = startBackground();
    await unlock(background);
    await unlock(background, fakeDatabase({ name: 'Other', masterPassword }));
    expect(await answer({ kind: 'status' }, background)).toMatchObject({
      unlocked: { name: 'Other' },
    });
    expect(await answer({ kind: 'status' }, startBackground())).toMatchObject({
      unlocked: { name: 'Other' },
    });
  });

  it.each([
    ['a wrong Master password', file, 'wrong', { kind: 'WrongKey' }],
    [
      'a file that is no KDBX file',
      new TextEncoder().encode('not a database'),
      masterPassword,
      { kind: 'UnsupportedFile', reason: 'NotKdbx' },
    ],
  ])('fails on %s and stores nothing', async (_, bytes, password, error) => {
    const background = startBackground();
    expect(await unlock(background, bytes, password)).toEqual({ unlocked: false, error });
    expect(await answer({ kind: 'status' }, background)).toMatchObject({ unlocked: null });
    expect(await answer({ kind: 'status' }, startBackground())).toMatchObject({ unlocked: null });
  });
});

describe('a background woken after the one that unlocked died', () => {
  it('rebuilds the Unlocked Database without the Master password', async () => {
    await unlock(startBackground());
    expect(await answer({ kind: 'status' }, startBackground())).toEqual({
      core: 'running',
      version: 'fake',
      unlocked: { name: 'Scenario' },
    });
  });

  it('measures the rebuild and its parts (ADR-0005)', async () => {
    await unlock(startBackground());
    performance.clearMeasures();
    await answer({ kind: 'status' }, startBackground());
    const measured = performance.getEntriesByType('measure').map((entry) => entry.name);
    expect(measured.toSorted()).toEqual(Object.values(rebuildMeasures).toSorted());
  });

  it('locks when the CachedKey no longer fits the Local copy', async () => {
    await unlock(startBackground());
    const stale = new FakeCore();
    stale.open = () => {
      // eslint-disable-next-line @typescript-eslint/only-throw-error -- the bindings throw CoreError values
      throw { kind: 'CachedKeyStale' };
    };
    expect(await answer({ kind: 'status' }, startBackground(stale))).toMatchObject({
      unlocked: null,
    });
    // The key material is gone: the next wake-up has nothing to rebuild from.
    expect(await answer({ kind: 'status' }, startBackground())).toMatchObject({ unlocked: null });
  });

  it('has no Unlocked Database when the Local copy is gone, as when site data is cleared', async () => {
    await unlock(startBackground());
    await new Promise((resolve) => {
      indexedDB.deleteDatabase('rimlock').onsuccess = resolve;
    });
    expect(await answer({ kind: 'status' }, startBackground())).toMatchObject({ unlocked: null });
  });

  it('keeps the key material while the Core is unavailable, so a later wake-up rebuilds', async () => {
    await unlock(startBackground());
    await answer({ kind: 'status' }, startBackgroundWithoutCore());
    expect(await answer({ kind: 'status' }, startBackground())).toMatchObject({
      unlocked: { name: 'Scenario' },
    });
  });

  it('records no rebuild when no Database was Unlocked', async () => {
    performance.clearMeasures();
    await answer({ kind: 'status' }, startBackground());
    expect(performance.getEntriesByType('measure')).toEqual([]);
  });
});

describe('the router', () => {
  /** Delivers `message` as the browser would from `sender`; resolves to the answer, if any. */
  async function deliver(message: unknown, sender: Browser.runtime.MessageSender) {
    startRouter(startBackground());
    const sendResponse = vi.fn();
    // The router's listener returns whether it will answer, as both browsers expect.
    const [handled] = (await fakeBrowser.runtime.onMessage.trigger(
      message,
      sender,
      sendResponse,
    )) as unknown[];
    if (handled !== true) return undefined;
    await vi.waitFor(() => {
      expect(sendResponse).toHaveBeenCalled();
    });
    return sendResponse.mock.calls[0]?.[0] as unknown;
  }

  const unlockMessage = () =>
    encodeRequest({ kind: 'unlock', file, masterPassword: Secret.fromText(masterPassword) });

  // The router reads only whether a sender has a tab.
  const tab = { id: 1 } as Browser.tabs.Tab;

  it.each<[string, Browser.runtime.MessageSender]>([
    ['the popup', { id: browser.runtime.id, url: browser.runtime.getURL('/popup.html') }],
    [
      'an extension tab',
      { id: browser.runtime.id, url: browser.runtime.getURL('/welcome.html'), tab, frameId: 0 },
    ],
  ])('takes an unlock from %s', async (_, sender) => {
    expect(await deliver(unlockMessage(), sender)).toEqual({ unlocked: true, name: 'Scenario' });
  });

  // The Composite key is entered only in the popup or an extension tab (ADR-0006).
  it.each<[string, Browser.runtime.MessageSender]>([
    ['a content script', { id: browser.runtime.id, url: 'https://example.test/', tab, frameId: 0 }],
    [
      'an extension-origin iframe inside a web page',
      { id: browser.runtime.id, url: browser.runtime.getURL('/inline-menu.html'), tab, frameId: 3 },
    ],
  ])('never answers an unlock from %s', async (_, sender) => {
    expect(await deliver(unlockMessage(), sender)).toBeUndefined();
    expect(await answer({ kind: 'status' }, startBackground())).toMatchObject({ unlocked: null });
  });
});
