// The CoreClient contract suite (docs/spec/engineering.md § Fakes and contract suites): the same
// tests against FakeCore (`pnpm test`) and against the real WASM Core (`pnpm test:e2e`), for
// everything the minimal Core does (docs/spec/core-api.md § 3, § 8, § 9).

import { beforeAll, describe, expect, it } from 'vitest';

import type { CoreClient, KeyComponent, UnlockedDatabase } from '../../src/background/core-client';
import type { FormatVersion, KdfParameters } from '../../src/core-bindings/rimlock_core_wasm.js';
import { Secret } from '../../src/shared/secret';

/** A Database file the subject's Core reads, and what the suite expects of it. */
export type TestDatabase = {
  bytes: Uint8Array;
  masterPassword?: string;
  keyFile?: Uint8Array;
  name: string;
  formatVersion: FormatVersion;
  kdf: KdfParameters['kind'];
};

/** The Databases every subject provides: one per kind of Composite key, and a KDBX 3.1 one. */
export const roles = ['password', 'keyFile', 'passwordAndKeyFile', 'kdbx31'] as const;
export type Role = (typeof roles)[number];

export type CoreSubject = {
  client: CoreClient;
  databases: Record<Role, TestDatabase>;
  /**
   * The `password` Database as its Local copy reads after another client saved it: the same
   * Composite key, but another KDF seed or other KDF parameters (ADR-0005).
   */
  staleLocalCopy: Uint8Array;
};

/** The Composite key that opens `database`, built fresh for every call. */
export function keyOf(database: TestDatabase): KeyComponent[] {
  const components: KeyComponent[] = [];
  if (database.masterPassword !== undefined) {
    components.push({ kind: 'Password', value: Secret.fromText(database.masterPassword) });
  }
  if (database.keyFile !== undefined) {
    components.push({ kind: 'KeyFile', bytes: database.keyFile.slice() });
  }
  return components;
}

const notADatabase = new TextEncoder().encode('not a database');

export function describeCoreClientContract(subjectFor: () => Promise<CoreSubject>): void {
  let subject: CoreSubject;
  let client: CoreClient;

  // One client for the whole suite: a case that kills the Core fails every later one with
  // CoreUnavailable, so check a single case with `-t`.
  beforeAll(async () => {
    subject = await subjectFor();
    client = subject.client;
  });

  describe('readHeader', () => {
    it.each(roles)(
      'reads the format version, KDF and challenge of the %s Database',
      async (role) => {
        const database = subject.databases[role];
        const result = await client.readHeader(database.bytes);
        if (!result.ok) throw new Error(`readHeader failed: ${result.error.kind}`);
        expect(result.value.formatVersion).toBe(database.formatVersion);
        expect(result.value.kdf.kind).toBe(database.kdf);
        expect(result.value.challenge).toBeInstanceOf(Uint8Array);
        expect(result.value.challenge.length).toBeGreaterThan(0);
      },
    );

    it.each([
      ['bytes that are not a KDBX file', notADatabase],
      ['no bytes', new Uint8Array()],
    ])('maps %s to UnsupportedFile NotKdbx', async (_, bytes) => {
      expect(await client.readHeader(bytes)).toEqual({
        ok: false,
        error: { kind: 'UnsupportedFile', reason: 'NotKdbx' },
      });
    });

    it('maps a file cut short after its signature to Corrupt Truncated', async () => {
      expect(await client.readHeader(subject.databases.password.bytes.slice(0, 12))).toEqual({
        ok: false,
        error: { kind: 'Corrupt', reason: 'Truncated' },
      });
    });
  });

  describe('unlock', () => {
    it.each(roles)('opens the %s Database with its Composite key', async (role) => {
      const database = subject.databases[role];
      const { db } = await unlocked(client, database);
      const info = await db.info();
      if (!info.ok) throw new Error(`info failed: ${info.error.kind}`);
      expect(info.value.name).toBe(database.name);
      expect(info.value.formatVersion).toBe(database.formatVersion);
    });

    it('wraps the CachedKey in a Secret', async () => {
      const { cachedKey } = await unlocked(client, subject.databases.password);
      expect(cachedKey).toBeInstanceOf(Secret);
      expect(JSON.stringify({ cachedKey })).toBe('{"cachedKey":"[Secret]"}');
    });

    it('leaves the Master password it was given usable', async () => {
      const database = subject.databases.password;
      const components = keyOf(database);
      await unlocked(client, database, components);
      const [password] = components;
      expect(password?.kind === 'Password' && password.value.reveal()).toBe(
        database.masterPassword,
      );
    });

    it.each<[string, (database: TestDatabase) => KeyComponent[]]>([
      ['a wrong Master password', () => [{ kind: 'Password', value: Secret.fromText('wrong') }]],
      ['no components', () => []],
      [
        'a Master password that is not UTF-8',
        () => [{ kind: 'Password', value: new Secret(new Uint8Array([0xff, 0xfe])) }],
      ],
      [
        'the Master password without the Key file',
        (database) => keyOf(database).filter((component) => component.kind !== 'KeyFile'),
      ],
      [
        'a challenge-response component, which no provider answers in the MVP',
        (database) => [
          ...keyOf(database),
          { kind: 'ChallengeResponse', response: new Uint8Array(20) },
        ],
      ],
    ])('maps %s to WrongKey', async (_, key) => {
      const database = subject.databases.passwordAndKeyFile;
      expect(await client.unlock(database.bytes, key(database))).toEqual({
        ok: false,
        error: { kind: 'WrongKey' },
      });
    });

    it('maps a second Master password, a bug in the caller, to Internal', async () => {
      const database = subject.databases.password;
      expect(await client.unlock(database.bytes, [...keyOf(database), ...keyOf(database)])).toEqual(
        { ok: false, error: { kind: 'Internal' } },
      );
    });

    it('fails on a file readHeader rejects with the same error', async () => {
      expect(await client.unlock(notADatabase, keyOf(subject.databases.password))).toEqual({
        ok: false,
        error: { kind: 'UnsupportedFile', reason: 'NotKdbx' },
      });
    });
  });
  describe('open', () => {
    it.each(roles)('rebuilds the %s Database from its CachedKey', async (role) => {
      const database = subject.databases[role];
      const { db, cachedKey } = await unlocked(client, database);
      const rebuilt = await client.open(database.bytes, cachedKey);
      if (!rebuilt.ok) throw new Error(`open failed: ${rebuilt.error.kind}`);
      expect(await rebuilt.value.info()).toEqual(await db.info());
    });

    it('leaves the CachedKey usable for the next wake-up', async () => {
      const database = subject.databases.password;
      const { cachedKey } = await unlocked(client, database);
      await client.open(database.bytes, cachedKey);
      expect((await client.open(database.bytes, cachedKey)).ok).toBe(true);
    });

    it('maps a Local copy another client saved since to CachedKeyStale', async () => {
      const { cachedKey } = await unlocked(client, subject.databases.password);
      expect(await client.open(subject.staleLocalCopy, cachedKey)).toEqual({
        ok: false,
        error: { kind: 'CachedKeyStale' },
      });
    });

    it('maps bytes that are no CachedKey to CachedKeyStale', async () => {
      expect(
        await client.open(subject.databases.password.bytes, Secret.fromText('not a cached key')),
      ).toEqual({ ok: false, error: { kind: 'CachedKeyStale' } });
    });

    it("refuses another Database's CachedKey", async () => {
      const { cachedKey } = await unlocked(client, subject.databases.passwordAndKeyFile);
      const result = await client.open(subject.databases.password.bytes, cachedKey);
      expect(result.ok || result.error.kind).toBeOneOf(['CachedKeyStale', 'WrongKey']);
    });

    it('fails on a file readHeader rejects with the same error', async () => {
      const { cachedKey } = await unlocked(client, subject.databases.password);
      expect(await client.open(notADatabase, cachedKey)).toEqual({
        ok: false,
        error: { kind: 'UnsupportedFile', reason: 'NotKdbx' },
      });
    });
  });

  describe('a freed handle', () => {
    it('answers Internal, a bug in the caller, instead of reaching the Core', async () => {
      const { db } = await unlocked(client, subject.databases.password);
      await db.free();
      expect(await db.info()).toEqual({ ok: false, error: { kind: 'Internal' } });
      expect((await client.readHeader(subject.databases.password.bytes)).ok).toBe(true);
    });

    it('takes a second free() without reaching the Core', async () => {
      const { db } = await unlocked(client, subject.databases.password);
      await db.free();
      await db.free();
      expect((await client.readHeader(subject.databases.password.bytes)).ok).toBe(true);
    });
  });
}

async function unlocked(
  client: CoreClient,
  database: TestDatabase,
  components = keyOf(database),
): Promise<{ db: UnlockedDatabase; cachedKey: Secret }> {
  const result = await client.unlock(database.bytes, components);
  if (!result.ok) throw new Error(`unlock failed: ${result.error.kind}`);
  return result.value;
}
