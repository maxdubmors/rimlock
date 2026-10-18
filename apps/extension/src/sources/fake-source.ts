// FakeSource: an in-memory Source, so Sync can be built and tested without a server or a file
// (docs/spec/engineering.md § Fakes and contract suites). The SourceAdapter contract suite
// (tests/contract/) holds it to what every real adapter does.

import type { SourceAdapter, SourceError, SourceResult, Version } from './source-adapter';

/** One file at a Source, with the faults a real Source has injected by the test. */
export class FakeSource implements SourceAdapter {
  #bytes: Uint8Array;
  #saves = 1;
  #fault: SourceError | undefined;

  constructor(bytes: Uint8Array) {
    this.#bytes = bytes.slice();
  }

  stat(): Promise<SourceResult<Version>> {
    const fault = this.#faultOf('stat');
    if (fault !== undefined) return Promise.resolve({ ok: false, error: fault });
    return Promise.resolve({ ok: true, value: this.#version() });
  }

  read(): Promise<SourceResult<{ bytes: Uint8Array; version: Version }>> {
    const fault = this.#faultOf('read');
    if (fault !== undefined) return Promise.resolve({ ok: false, error: fault });
    return Promise.resolve({
      ok: true,
      value: { bytes: this.#bytes.slice(), version: this.#version() },
    });
  }

  write(bytes: Uint8Array, ifVersion: Version): Promise<SourceResult<Version>> {
    const fault = this.#faultOf('write');
    if (fault !== undefined) return Promise.resolve({ ok: false, error: fault });
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

  /** From now on the Source fails as the adapter would report `fault`. */
  inject(fault: SourceError): void {
    this.#fault = fault;
  }

  /** A failing write condition fails only writes; every other fault fails every operation. */
  #faultOf(operation: 'stat' | 'read' | 'write'): SourceError | undefined {
    return this.#fault === 'conflict' && operation !== 'write' ? undefined : this.#fault;
  }

  #save(bytes: Uint8Array): void {
    this.#bytes = bytes.slice();
    this.#saves += 1;
  }

  #version(): Version {
    return { token: `fake-${String(this.#saves)}` };
  }
}
