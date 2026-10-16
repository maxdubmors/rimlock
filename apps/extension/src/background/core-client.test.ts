// What the contract suite (tests/contract/) cannot show against the real Core, which never panics
// on purpose and answers every call at once: stubs of the bindings, one per test.

import { describe, expect, it, vi, type Mock } from 'vitest';

import type { CoreError, DatabaseInfo, HeaderInfo } from '../core-bindings/rimlock_core_wasm.js';
import { Secret } from '../shared/secret';
import { CoreClient, type CoreBindings } from './core-client';

const header: HeaderInfo = {
  formatVersion: '4.1',
  kdf: { kind: 'AesKdf', rounds: 1 },
  challenge: new Uint8Array([1]),
};
const info: DatabaseInfo = {
  name: 'stub',
  rootGroup: '7f6b2a3c-0000-4000-8000-000000000001',
  recycleBinEnabled: false,
  formatVersion: '4.1',
};
const unavailable = { ok: false, error: { kind: 'CoreUnavailable' } };

/** What the bindings throw: a value, not an Error (core-api.md § 8). */
function fail(error: CoreError | { kind: string }): never {
  // eslint-disable-next-line @typescript-eslint/only-throw-error -- the bindings throw CoreError values
  throw error;
}

type Handle = {
  info: Mock<() => DatabaseInfo | Promise<DatabaseInfo>>;
  free: Mock<() => void>;
  [Symbol.dispose]: Mock<() => void>;
};

/** A handle whose `info` the test answers, and the bindings that hand it out. */
function stubCore(handleInfo: () => DatabaseInfo | Promise<DatabaseInfo> = () => info) {
  const handle: Handle = { info: vi.fn(handleInfo), free: vi.fn(), [Symbol.dispose]: vi.fn() };
  const core = {
    coreInfo: vi.fn(() => ({ version: '1.2.3' })),
    readHeader: vi.fn<(bytes: Uint8Array) => HeaderInfo>(() => header),
    unlock: vi.fn<
      (bytes: Uint8Array, components: unknown) => { db: Handle; cachedKey: Uint8Array }
    >(() => ({ db: handle, cachedKey: new Uint8Array([7, 7]) })),
    open: vi.fn<(bytes: Uint8Array, cachedKey: unknown) => Handle>(() => handle),
  };
  return { core, handle, client: new CoreClient(() => Promise.resolve(core as CoreBindings)) };
}

async function unlockedDb(client: CoreClient) {
  const result = await client.unlock(new Uint8Array(), [
    { kind: 'Password', value: Secret.fromText('pw') },
  ]);
  if (!result.ok) throw new Error(result.error.kind);
  return result.value.db;
}

describe('a panic in the Core', () => {
  const panic = () => {
    throw new WebAssembly.RuntimeError('unreachable');
  };

  it('is CoreUnavailable', async () => {
    const { core, client } = stubCore();
    core.readHeader.mockImplementation(panic);
    expect(await client.readHeader(new Uint8Array())).toEqual(unavailable);
  });

  it('marks the instance dead: no later call reaches it', async () => {
    const { core, handle, client } = stubCore();
    const db = await unlockedDb(client);
    core.readHeader.mockImplementation(panic);
    await client.readHeader(new Uint8Array());

    expect(await client.coreInfo()).toEqual(unavailable);
    expect(await client.readHeader(new Uint8Array())).toEqual(unavailable);
    expect(await db.info()).toEqual(unavailable);
    await db.free();
    expect(core.coreInfo).not.toHaveBeenCalled();
    expect(core.readHeader).toHaveBeenCalledTimes(1);
    expect(handle.info).not.toHaveBeenCalled();
    expect(handle.free).not.toHaveBeenCalled();
  });

  it('is any failure of coreInfo, which holds no state: the bindings are broken', async () => {
    const { core, client } = stubCore();
    core.coreInfo.mockImplementation(() => fail({ kind: 'Internal' }));
    expect(await client.coreInfo()).toEqual(unavailable);
    expect(await client.readHeader(new Uint8Array())).toEqual(unavailable);
    expect(core.readHeader).not.toHaveBeenCalled();
  });

  it('is told apart from a CoreError by its shape', async () => {
    const { core, client } = stubCore();
    core.readHeader.mockImplementationOnce(() => {
      fail({ kind: 'Corrupt' });
    });
    expect(await client.readHeader(new Uint8Array())).toEqual(unavailable);
  });
});

describe('a Core that fails to instantiate', () => {
  it('is CoreUnavailable, and the next call tries again', async () => {
    const { core } = stubCore();
    const load = vi
      .fn<() => Promise<CoreBindings>>()
      .mockRejectedValueOnce(new Error('CompileError'))
      .mockResolvedValue(core as CoreBindings);
    const client = new CoreClient(load);
    expect(await client.coreInfo()).toEqual(unavailable);
    expect(await client.coreInfo()).toEqual({ ok: true, value: { version: '1.2.3' } });
    expect(await client.coreInfo()).toEqual({ ok: true, value: { version: '1.2.3' } });
    expect(load).toHaveBeenCalledTimes(2);
  });
});

describe('a Secret input', () => {
  it('reaches the Core as UTF-8 bytes, wiped after the call', async () => {
    const { core, client } = stubCore();
    let received: Uint8Array | undefined;
    core.unlock.mockImplementation((_bytes: Uint8Array, components: unknown) => {
      const [password] = components as [{ kind: 'Password'; value: Uint8Array }];
      received = password.value;
      expect([...received]).toEqual([0x70, 0xc3, 0xa4, 0x73, 0x73]);
      fail({ kind: 'WrongKey' });
    });
    await client.unlock(new Uint8Array(), [{ kind: 'Password', value: Secret.fromText('päss') }]);
    expect(received && [...received]).toEqual([0, 0, 0, 0, 0]);
  });

  it('reaches open as the CachedKey bytes, wiped after the call', async () => {
    const { core, client } = stubCore();
    let received: Uint8Array | undefined;
    core.open.mockImplementation((_bytes: Uint8Array, cachedKey: unknown) => {
      received = cachedKey as Uint8Array;
      expect([...received]).toEqual([1, 2, 3]);
      fail({ kind: 'CachedKeyStale' });
    });
    await client.open(new Uint8Array(), new Secret(new Uint8Array([1, 2, 3])));
    expect(received && [...received]).toEqual([0, 0, 0]);
  });
});

describe('calls on a handle', () => {
  it('never run concurrently: the next starts when the one before has finished', async () => {
    let answer: (value: DatabaseInfo) => void = () => undefined;
    const { handle, client } = stubCore(
      () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
    );
    const db = await unlockedDb(client);
    const first = db.info();
    const freed = db.free();
    await vi.waitFor(() => {
      expect(handle.info).toHaveBeenCalled();
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(handle.free).not.toHaveBeenCalled();

    answer(info);
    expect(await first).toEqual({ ok: true, value: info });
    await freed;
    expect(handle.free).toHaveBeenCalledOnce();
    expect(await db.info()).toEqual({ ok: false, error: { kind: 'Internal' } });
  });
});
