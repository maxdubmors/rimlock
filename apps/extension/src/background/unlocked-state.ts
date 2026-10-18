// The Unlocked state: at most one Unlocked Database (ADR-0015), held only by the background and
// rebuilt on every wake-up from its Local copy and the CachedKey in storage.session, without the
// Master password and without the KDF (ADR-0005, databases-and-unlock.md § The Unlocked state).

import { browser } from 'wxt/browser';

import type { UnlockFailure, UnlockResponse } from '../protocol/messages';
import { decodeSecret, encodeSecret, type EncodedSecret } from '../protocol/secret-codec';
import type { Secret } from '../shared/secret';
import type { CachedKey, CoreClient, CoreResult, UnlockedDatabase } from './core-client';
import { readLocalCopy, storeLocalCopy } from './local-copy';

/** The storage.session item that says which Database is Unlocked, with its CachedKey. */
export const unlockedItem = 'unlocked';

type StoredUnlocked = { database: string; cachedKey: EncodedSecret };

/**
 * The `performance.measure` entries of a wake-up rebuild, in the background's own timeline
 * (verification.md V1). `total` runs from the storage.session read to the opened Database.
 */
export const rebuildMeasures = {
  total: 'rimlock rebuild',
  instantiate: 'rimlock rebuild: WASM instantiate',
  readLocalCopy: 'rimlock rebuild: IndexedDB read',
  open: 'rimlock rebuild: open',
} as const;

type Current = { db: UnlockedDatabase; name: string };

export class UnlockedState {
  readonly #core: CoreClient;
  /** The Unlocked Database; the first read rebuilds it from what the last background stored. */
  #current: Promise<Current | undefined> | undefined;

  constructor(core: CoreClient) {
    this.#core = core;
  }

  /** The name of the Unlocked Database, or `undefined` while every Database is Locked. */
  async name(): Promise<string | undefined> {
    return (await this.#currentDatabase())?.name;
  }

  /**
   * Adds a Database from its file by unlocking it: `readHeader` → `unlock`, then its Local copy
   * and CachedKey are stored, and it becomes the Unlocked Database. A Database that never opened
   * is never stored (databases-and-unlock.md § Adding a Database = the first unlock).
   */
  async unlock(file: Uint8Array, masterPassword: Secret): Promise<UnlockResponse> {
    const header = await this.#core.readHeader(file);
    if (!header.ok) return failed(header);
    const unlocked = await this.#core.unlock(file, [{ kind: 'Password', value: masterPassword }]);
    if (!unlocked.ok) return failed(unlocked);
    const { db, cachedKey } = unlocked.value;
    const info = await db.info();
    if (!info.ok) {
      await db.free();
      return failed(info);
    }
    const database = crypto.randomUUID();
    try {
      await storeLocalCopy(database, file);
      await storeCachedKey(database, cachedKey);
    } catch {
      await db.free();
      return { unlocked: false, error: { kind: 'Internal' } };
    } finally {
      cachedKey.wipe();
    }
    const previous = await this.#currentDatabase();
    this.#current = Promise.resolve({ db, name: info.value.name });
    await previous?.db.free();
    return { unlocked: true, name: info.value.name };
  }

  #currentDatabase(): Promise<Current | undefined> {
    this.#current ??= this.#rebuild();
    return this.#current;
  }

  /** The wake-up rebuild: `open(localCopy, cachedKey)`; a stale CachedKey locks. */
  async #rebuild(): Promise<Current | undefined> {
    const start = performance.now();
    // The Core instantiates while storage.session is read, so its measure starts with the wake-up.
    const instantiated = timed(() => this.#core.coreInfo());
    const stored = await readStoredUnlocked();
    if (stored === undefined) return undefined;
    const [core, localCopy] = await Promise.all([
      instantiated,
      timed(() => readLocalCopy(stored.database)),
    ]);
    record(rebuildMeasures.instantiate, core);
    record(rebuildMeasures.readLocalCopy, localCopy);
    // The key material stays: the next background may get a working Core.
    if (!core.value.ok) return undefined;
    const bytes = localCopy.value;
    const cachedKey = decodeSecret(stored.cachedKey);
    // The Local copy and storage.session are out of step: nothing to open, so lock.
    if (bytes === undefined || cachedKey === undefined) {
      cachedKey?.wipe();
      return lock();
    }
    const opened = await timed(() => this.#core.open(bytes, cachedKey));
    cachedKey.wipe();
    record(rebuildMeasures.open, opened);
    if (!opened.value.ok) return opened.value.error.kind === 'CachedKeyStale' ? lock() : undefined;
    performance.measure(rebuildMeasures.total, { start });
    const db = opened.value.value;
    const info = await db.info();
    if (info.ok) return { db, name: info.value.name };
    await db.free();
    return undefined;
  }
}

/**
 * The one function that puts key material into storage.session (databases-and-unlock.md § Lock,
 * one restore point; ADR-0012).
 */
async function storeCachedKey(database: string, cachedKey: CachedKey): Promise<void> {
  const stored: StoredUnlocked = { database, cachedKey: encodeSecret(cachedKey) };
  await browser.storage.session.set({ [unlockedItem]: stored });
}

async function readStoredUnlocked(): Promise<StoredUnlocked | undefined> {
  const items = await browser.storage.session.get(unlockedItem);
  // Only storeCachedKey writes this item.
  return items[unlockedItem] as StoredUnlocked | undefined;
}

/** Deletes the key material from storage.session: every Database is Locked. */
async function lock(): Promise<undefined> {
  await browser.storage.session.remove(unlockedItem);
  return undefined;
}

/** What `run` resolved to, and when it started and ended, for `record`. */
async function timed<T>(run: () => Promise<T>): Promise<{ value: T; start: number; end: number }> {
  const start = performance.now();
  const value = await run();
  return { value, start, end: performance.now() };
}

function record(name: string, { start, end }: { start: number; end: number }): void {
  performance.measure(name, { start, end });
}

function failed(result: { ok: false; error: CoreFailure }): UnlockResponse {
  return { unlocked: false, error: unlockFailure(result.error) };
}

type CoreFailure = (CoreResult<unknown> & { ok: false })['error'];

function unlockFailure(error: CoreFailure): UnlockFailure {
  switch (error.kind) {
    case 'WrongKey':
      return { kind: 'WrongKey' };
    case 'UnsupportedFile':
    case 'Corrupt':
      return { kind: error.kind, reason: error.reason };
    // No challenge-response provider in the MVP; the rest cannot come from readHeader or unlock.
    case 'ChallengeResponseRequired':
    case 'CachedKeyStale':
    case 'RemoteKeyChanged':
    case 'NotFound':
    case 'EntryChanged':
    case 'InvalidChange':
    case 'VerifyFailed':
    case 'Internal':
    case 'CoreUnavailable':
      return { kind: 'Internal' };
  }
}
