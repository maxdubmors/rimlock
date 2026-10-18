// The SourceAdapter contract suite (docs/spec/engineering.md § Fakes and contract suites): what
// docs/spec/core-api.md § 10 asks of a Source, run against FakeSource in `pnpm test`, and written
// for the real adapters to run without copying a test.

import { beforeEach, describe, expect, it } from 'vitest';

import type { SourceFault } from '../../src/sources/fake-source';
import type { SourceAdapter, SourceResult, Version } from '../../src/sources/source-adapter';

/** One Source, fresh for one test, and the means to act on it as nobody but the test can. */
export type SourceSubject = {
  adapter: SourceAdapter;
  /** Saves `bytes` to the file as another client would. */
  saveElsewhere(bytes: Uint8Array): Promise<void>;
  /**
   * Another client saves `bytes` while the adapter's next write is under way, after the adapter
   * checked the version: the write condition fails.
   */
  saveElsewhereDuringNextWrite(bytes: Uint8Array): Promise<void>;
  /** Brings about the fault that the adapter reports as `fault`, for the rest of the test. */
  failWith(fault: SourceFault): Promise<void>;
};

export type SourceContract = {
  /** A fresh Source whose file holds `bytes`. */
  subjectFor(bytes: Uint8Array): Promise<SourceSubject>;
  /** The faults the Source can have and the subject can bring about: WebDAV asks no permission. */
  faults: readonly SourceFault[];
};

/** Faults that stop every operation, unlike a missing file. */
const everyOperation: readonly SourceFault[] = ['offline', 'auth', 'permission-needed'];

const saved = new TextEncoder().encode('the file as the Source holds it');
const edited = new TextEncoder().encode('the file as rimlock saved it');
const elsewhere = new TextEncoder().encode('the file as another client saved it');

export function describeSourceAdapterContract(contract: SourceContract): void {
  let subject: SourceSubject;
  let adapter: SourceAdapter;

  beforeEach(async () => {
    subject = await contract.subjectFor(saved.slice());
    adapter = subject.adapter;
  });

  describe('stat', () => {
    it('gives the same version while nothing changes', async () => {
      const first = await versionOf(adapter);
      expect((await versionOf(adapter)).token).toBe(first.token);
    });

    it('gives another version once another client saved the file', async () => {
      const before = await versionOf(adapter);
      await subject.saveElsewhere(elsewhere.slice());
      expect((await versionOf(adapter)).token).not.toBe(before.token);
    });
  });

  describe('read', () => {
    it('returns the bytes of the file and the version stat gives', async () => {
      const { bytes, version } = await contentOf(adapter);
      expect(bytes).toEqual(saved);
      expect(version.token).toBe((await versionOf(adapter)).token);
    });

    it('returns bytes the caller can change without changing the file', async () => {
      (await contentOf(adapter)).bytes.fill(0);
      expect((await contentOf(adapter)).bytes).toEqual(saved);
    });
  });

  describe('write', () => {
    it('with the current version saves the bytes and returns a new version', async () => {
      const before = await versionOf(adapter);
      const after = await written(adapter, edited, before);
      expect(after.token).not.toBe(before.token);
      expect(await contentOf(adapter)).toEqual({ bytes: edited, version: after });
      expect((await versionOf(adapter)).token).toBe(after.token);
    });

    it('keeps what it saved when the caller changes its bytes afterwards', async () => {
      const bytes = edited.slice();
      await adapter.write(bytes, await versionOf(adapter));
      bytes.fill(0);
      expect((await contentOf(adapter)).bytes).toEqual(edited);
    });

    it('with a stale version gives conflict and leaves the file as it is', async () => {
      const stale = await versionOf(adapter);
      const current = await written(adapter, edited, stale);
      expect(await adapter.write(saved.slice(), stale)).toEqual({ ok: false, error: 'conflict' });
      expect(await contentOf(adapter)).toEqual({ bytes: edited, version: current });
    });

    it('gives conflict when another client saved the file between stat and write', async () => {
      const version = await versionOf(adapter);
      await subject.saveElsewhere(elsewhere.slice());
      expect(await adapter.write(edited.slice(), version)).toEqual({
        ok: false,
        error: 'conflict',
      });
      expect((await contentOf(adapter)).bytes).toEqual(elsewhere);
    });

    it('gives conflict when another client saves the file during the write', async () => {
      const version = await versionOf(adapter);
      await subject.saveElsewhereDuringNextWrite(elsewhere.slice());
      expect(await adapter.write(edited.slice(), version)).toEqual({
        ok: false,
        error: 'conflict',
      });
      const after = await contentOf(adapter);
      expect(after.bytes).toEqual(elsewhere);
      expect(after.version.token).not.toBe(version.token);
    });
  });

  describe.each(contract.faults.filter((fault) => everyOperation.includes(fault)))(
    'with the %s fault',
    (fault) => {
      it('fails stat, read and write with it', async () => {
        const version = await versionOf(adapter);
        await subject.failWith(fault);
        const failed = { ok: false, error: fault };
        expect(await adapter.stat()).toEqual(failed);
        expect(await adapter.read()).toEqual(failed);
        expect(await adapter.write(edited.slice(), version)).toEqual(failed);
      });
    },
  );

  describe.runIf(contract.faults.includes('not-found'))('with the file gone', () => {
    it('fails stat and read with not-found', async () => {
      await subject.failWith('not-found');
      const failed = { ok: false, error: 'not-found' };
      expect(await adapter.stat()).toEqual(failed);
      expect(await adapter.read()).toEqual(failed);
    });
  });
}

async function written(
  adapter: SourceAdapter,
  bytes: Uint8Array,
  ifVersion: Version,
): Promise<Version> {
  return succeeded('write', await adapter.write(bytes.slice(), ifVersion));
}

async function contentOf(adapter: SourceAdapter): Promise<{ bytes: Uint8Array; version: Version }> {
  return succeeded('read', await adapter.read());
}

async function versionOf(adapter: SourceAdapter): Promise<Version> {
  return succeeded('stat', await adapter.stat());
}

function succeeded<T>(operation: string, result: SourceResult<T>): T {
  if (!result.ok) throw new Error(`${operation} failed: ${result.error}`);
  return result.value;
}
