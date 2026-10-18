// The canary check every end-to-end scenario ends with (engineering.md § Tests, Secret leaks): the
// test Databases carry unique canary markers, and none may appear in storage.local, IndexedDB,
// storage.session, a message to a content script or the console. The encrypted Local copy in
// IndexedDB is allowed, since its bytes show no marker, and in storage.session only the CachedKey
// may hold key material: its bytes are a canary everywhere else.

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { afterEach, expect, inject } from 'vitest';

import { unlockedItem } from '../../src/background/unlocked-state';
import type { ExtensionSession } from './browsers';

/** One entry of the generator's `canaries.json` (engineering.md § Corpora and data). */
export type Canary = { database: string; kind: string; value: string };

/** A canary found where it must not be. */
export type Leak = { place: string; canary: string };

/** Where a dump came from, and its text: bytes as Latin-1, anything else as JSON. */
type Dumped = { place: string; text: string };

/** A form a canary may take in a dump, and the one place, if any, it is allowed in. */
type Needle = { text: string; canary: string; allowedIn?: string };

const cachedKeyPlace = `storage.session ${unlockedItem}`;

let generated: Promise<Canary[]> | undefined;

/** Every canary the test-Database generator wrote for this run. */
export function generatedCanaries(): Promise<Canary[]> {
  generated ??= readFile(join(inject('core').fixturesDir, 'canaries.json'), 'utf8').then(
    (text) => JSON.parse(text) as Canary[],
  );
  return generated;
}

/**
 * Runs the canary check after each test of the calling file, on the session `current` returns
 * then; a test that leaves no session is not checked.
 */
export function useCanaryCheck(current: () => ExtensionSession | undefined): void {
  afterEach(async () => {
    const session = current();
    if (session === undefined) return;
    expect(await findLeaks(session, await generatedCanaries())).toEqual([]);
  });
}

/** Every place one of `canaries`, or the stored CachedKey, shows up in where it must not. */
export async function findLeaks(session: ExtensionSession, canaries: Canary[]): Promise<Leak[]> {
  const page = await session.openPage('popup.html');
  let dumped: Dumped[];
  try {
    dumped = await page.evaluate(dumpStorage);
  } finally {
    await page.close();
  }
  dumped.push(
    ...(await session.receivedMessages()).map((text) => ({
      place: 'a message to a content script',
      text,
    })),
    { place: 'the console', text: await session.consoleOutput() },
  );
  const needles = canaries.flatMap((canary) =>
    formsOf(new TextEncoder().encode(canary.value)).map((text) => ({
      text,
      canary: `${canary.kind} of ${canary.database}`,
    })),
  );
  const cachedKey = storedCachedKey(dumped);
  if (cachedKey !== undefined) {
    needles.push(
      ...formsOf(cachedKey).map((text) => ({
        text,
        canary: 'the CachedKey',
        allowedIn: cachedKeyPlace,
      })),
    );
  }
  return scan(dumped, needles);
}

/** The bytes of the CachedKey in storage.session, if a Database is Unlocked. */
function storedCachedKey(dumped: Dumped[]): Uint8Array | undefined {
  const item = dumped.find((entry) => entry.place === cachedKeyPlace);
  if (item === undefined) return undefined;
  const stored = JSON.parse(item.text) as { cachedKey?: { $secret?: unknown } };
  const encoded = stored.cachedKey?.$secret;
  return typeof encoded === 'string' ? new Uint8Array(Buffer.from(encoded, 'base64')) : undefined;
}

/**
 * The texts `bytes` shows up as: the bytes themselves, as Latin-1, and base64 at each of the
 * three alignments it may have inside a longer base64 text, such as the Secret codec writes.
 */
function formsOf(bytes: Uint8Array): string[] {
  const forms = [Buffer.from(bytes).toString('latin1')];
  for (const before of [0, 1, 2]) {
    const encoded = Buffer.concat([Buffer.alloc(before), bytes]).toString('base64');
    // Only the characters that encode nothing but `bytes`.
    const from = 4 * Math.ceil(before / 3);
    const to = 4 * Math.floor((before + bytes.length) / 3);
    if (to > from) forms.push(encoded.slice(from, to));
  }
  return forms;
}

/** Finds every needle in every dump at once: thousands of canaries over megabytes of dumps. */
function scan(dumped: Dumped[], needles: Needle[]): Leak[] {
  const prefixLength = Math.min(16, ...needles.map((needle) => needle.text.length));
  const byPrefix = new Map<string, Needle[]>();
  for (const needle of needles) {
    const prefix = needle.text.slice(0, prefixLength);
    byPrefix.set(prefix, [...(byPrefix.get(prefix) ?? []), needle]);
  }
  const leaks = new Map<string, Leak>();
  for (const { place, text } of dumped) {
    for (let at = 0; at + prefixLength <= text.length; at++) {
      for (const needle of byPrefix.get(text.slice(at, at + prefixLength)) ?? []) {
        if (needle.allowedIn === place || !text.startsWith(needle.text, at)) continue;
        leaks.set(`${place}\n${needle.canary}`, { place, canary: needle.canary });
      }
    }
  }
  return [...leaks.values()];
}

/**
 * Evaluated in an extension page, which shares the background's storage and IndexedDB: every
 * item of storage.local and storage.session, and every record of every IndexedDB database.
 */
async function dumpStorage(): Promise<Dumped[]> {
  type Api = typeof import('wxt/browser').browser;
  const global = globalThis as unknown as { browser?: Api; chrome: Api };
  const api = global.browser ?? global.chrome;

  const latin1 = (bytes: Uint8Array) => {
    let text = '';
    for (let start = 0; start < bytes.length; start += 0x8000) {
      text += String.fromCharCode(...bytes.subarray(start, start + 0x8000));
    }
    return text;
  };
  const bytesOf = (value: unknown) =>
    value instanceof ArrayBuffer
      ? new Uint8Array(value)
      : ArrayBuffer.isView(value)
        ? new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
        : undefined;
  // Bytes nested in a value show as base64, which the check also looks for.
  const textOf = (value: unknown) => {
    const bytes = bytesOf(value);
    if (bytes !== undefined) return latin1(bytes);
    return JSON.stringify(value, (_, nested: unknown) => {
      const inner = bytesOf(nested);
      return inner === undefined ? nested : btoa(latin1(inner));
    });
  };
  const request = <T>(started: IDBRequest<T>) =>
    new Promise<T>((resolve, reject) => {
      started.onsuccess = () => {
        resolve(started.result);
      };
      started.onerror = () => {
        reject(started.error ?? new Error('IndexedDB request failed'));
      };
    });

  const dumped: Dumped[] = [];
  for (const area of ['local', 'session'] as const) {
    const items = await api.storage[area].get(null);
    for (const [key, value] of Object.entries(items)) {
      dumped.push({ place: `storage.${area} ${key}`, text: textOf(value) });
    }
  }
  for (const { name } of await indexedDB.databases()) {
    if (name === undefined) continue;
    const database = await request(indexedDB.open(name));
    try {
      for (const store of database.objectStoreNames) {
        const objects = database.transaction(store).objectStore(store);
        const [keys, values] = await Promise.all([
          request(objects.getAllKeys()),
          request(objects.getAll()),
        ]);
        keys.forEach((key, index) => {
          const place = `IndexedDB ${name}/${store} ${textOf(key)}`;
          dumped.push({ place, text: textOf(values[index]) });
        });
      }
    } finally {
      database.close();
    }
  }
  return dumped;
}
