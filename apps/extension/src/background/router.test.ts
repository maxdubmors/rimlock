import { describe, expect, it } from 'vitest';

import { Secret } from '../shared/secret';
import { CoreClient, type CoreBindings } from './core-client';
import { FakeCore, fakeDatabase } from './fake-core';
import { answer, type Background } from './router';
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
    const client = new CoreClient(() => Promise.reject(new Error('no WebAssembly')));
    const background = { core: client, unlocked: new UnlockedState(client) };
    expect(await answer({ kind: 'status' }, background)).toEqual({ core: 'unavailable' });
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

  it('keeps the key material while the Core is unavailable, so a later wake-up rebuilds', async () => {
    await unlock(startBackground());
    const client = new CoreClient(() => Promise.reject(new Error('no WebAssembly')));
    await answer({ kind: 'status' }, { core: client, unlocked: new UnlockedState(client) });
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
