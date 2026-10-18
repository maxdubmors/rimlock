// FakeSource: an in-memory Source, so Sync can be built and tested without a server or a file
// (docs/spec/engineering.md § Fakes and contract suites). The SourceAdapter contract suite
// (tests/contract/) holds it to what docs/spec/core-api.md § 10 asks of every adapter.

import type { SourceAdapter, SourceError, SourceResult, Version } from './source-adapter';

/** A fault that stays until the test ends; a `conflict` comes only from another client's save. */
export type SourceFault = Exclude<SourceError, 'conflict'>;

/** One file at a Source; the test drives what other clients and failures do to it. */
export class FakeSource implements SourceAdapter {
  #bytes: Uint8Array;
  #saves = 1;
  #fault: SourceFault | undefined;
  #saveDuringNextWrite: Uint8Array | undefined;

  constructor(bytes: Uint8Array) {
    this.#bytes = bytes.slice();
  }

  stat(): Promise<SourceResult<Version>> {
    return this.#answer(() => this.#version());
  }

  read(): Promise<SourceResult<{ bytes: Uint8Array; version: Version }>> {
    return this.#answer(() => ({ bytes: this.#bytes.slice(), version: this.#version() }));
  }

  write(bytes: Uint8Array, ifVersion: Version): Promise<SourceResult<Version>> {
    if (this.#fault !== undefined) return Promise.resolve({ ok: false, error: this.#fault });
    const other = this.#saveDuringNextWrite;
    this.#saveDuringNextWrite = undefined;
    if (other !== undefined) this.#save(other);
    if (ifVersion.token !== this.#version().token) {
      return Promise.resolve({ ok: false, error: 'conflict' });
    }
    this.#save(bytes);
    return Promise.resolve({ ok: true, value: this.#version() });
  }

  /** Another client saves `bytes` to the file, so its version changes under the caller. */
  saveElsewhere(bytes: Uint8Array): void {
    this.#save(bytes);
  }

  /**
   * Another client saves `bytes` while the next write is under way, after the caller took its
   * version: the write condition fails.
   */
  saveElsewhereDuringNextWrite(bytes: Uint8Array): void {
    this.#saveDuringNextWrite = bytes.slice();
  }

  /** From now on every operation fails as the adapter reports `fault`. */
  failWith(fault: SourceFault): void {
    this.#fault = fault;
  }

  #answer<T>(value: () => T): Promise<SourceResult<T>> {
    if (this.#fault !== undefined) return Promise.resolve({ ok: false, error: this.#fault });
    return Promise.resolve({ ok: true, value: value() });
  }

  #save(bytes: Uint8Array): void {
    this.#bytes = bytes.slice();
    this.#saves += 1;
  }

  #version(): Version {
    return { token: `fake-${String(this.#saves)}` };
  }
}
