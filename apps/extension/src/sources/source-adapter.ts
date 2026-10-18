// The Source seam (docs/spec/core-api.md § 10): adapters move a Database file's bytes to and from
// its Source and do nothing else. Sync, above them, merges before it writes.

import type { Result } from '../shared/result';

/** A version of the file at the Source: opaque, compared only for equality. */
export type Version = { readonly token: string };

export type SourceError = 'offline' | 'not-found' | 'auth' | 'permission-needed' | 'conflict';

export type SourceResult<T> = Result<T, SourceError>;

export interface SourceAdapter {
  /** Cheap: `lastModified`/size, or an ETag (PROPFIND). */
  stat(): Promise<SourceResult<Version>>;
  read(): Promise<SourceResult<{ bytes: Uint8Array; version: Version }>>;
  /** Writes only while the file is still at `ifVersion`; a changed remote is `conflict`. */
  write(bytes: Uint8Array, ifVersion: Version): Promise<SourceResult<Version>>;
  /** Chrome's `FileSystemObserver`; later the Companion. Returns the call that stops watching. */
  watch?(onChange: () => void): () => void;
}
