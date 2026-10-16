// FakeCore: an in-memory stand-in for the Core's bindings, so TypeScript-only work needs no Rust
// toolchain (docs/spec/engineering.md § Fakes and contract suites). The CoreClient contract suite
// (tests/contract/) holds it to what the real Core does.
//
// A fake Database is JSON behind a marker, not KDBX: everything `readHeader`, `unlock` and `open`
// need travels in its bytes, so the fake holds no state between calls, like the Core.

import type {
  CoreError,
  CoreInfo,
  DatabaseInfo,
  FormatVersion,
  HeaderInfo,
  KdfParameters,
  KeyComponent,
  UnlockedDatabase,
} from '../core-bindings/rimlock_core_wasm.js';
import type { CoreBindings } from './core-client';

const fileMarker = 'FAKEKDBX';
const cachedKeyMarker = 'FAKEKEY1';

/** The Composite key, its parts as hex: what both a fake file and a fake CachedKey hold. */
type FakeKey = { password?: string; keyFile?: string };

type FakeFile = {
  name: string;
  formatVersion: FormatVersion;
  kdf: KdfParameters;
  seed: string;
  key: FakeKey;
};

export type FakeDatabaseOptions = {
  name?: string;
  formatVersion?: FormatVersion;
  kdf?: KdfParameters['kind'];
  /** Another seed is another save of the same Database, as another client draws one (ADR-0005). */
  seed?: string;
  masterPassword?: string;
  keyFile?: Uint8Array;
};

/** The bytes of a fake Database that FakeCore reads. */
export function fakeDatabase(options: FakeDatabaseOptions = {}): Uint8Array {
  const file: FakeFile = {
    name: options.name ?? 'Fake Database',
    formatVersion: options.formatVersion ?? '4.1',
    kdf: kdfParameters(options.kdf ?? 'Argon2d'),
    seed: options.seed ?? 'seed',
    key: {
      ...(options.masterPassword !== undefined && {
        password: hex(new TextEncoder().encode(options.masterPassword)),
      }),
      ...(options.keyFile !== undefined && { keyFile: hex(options.keyFile) }),
    },
  };
  return encode(fileMarker, file);
}

function kdfParameters(kind: KdfParameters['kind']): KdfParameters {
  return kind === 'AesKdf'
    ? { kind, rounds: 1000 }
    : { kind, iterations: 2, memoryBytes: 1024 * 1024, parallelism: 2 };
}

export class FakeCore implements CoreBindings {
  coreInfo(): CoreInfo {
    return { version: 'fake' };
  }

  readHeader(bytes: Uint8Array): HeaderInfo {
    const file = readFile(bytes);
    return {
      formatVersion: file.formatVersion,
      kdf: file.kdf,
      challenge: new TextEncoder().encode(file.seed),
    };
  }

  unlock(
    bytes: Uint8Array,
    components: KeyComponent[],
  ): { db: UnlockedDatabase; cachedKey: Uint8Array } {
    const file = readFile(bytes);
    const key = fakeKeyOf(components);
    if (!sameKey(key, file.key)) fail({ kind: 'WrongKey' });
    const cachedKey = encode(cachedKeyMarker, { seed: file.seed, kdf: file.kdf, key });
    return { db: new FakeUnlockedDatabase(file), cachedKey };
  }

  open(localCopyBytes: Uint8Array, cachedKey: Uint8Array): UnlockedDatabase {
    const file = readFile(localCopyBytes);
    const decoded = decode(cachedKeyMarker, cachedKey);
    if (decoded === undefined || decoded === 'incomplete') fail({ kind: 'CachedKeyStale' });
    const cached = decoded.json as Pick<FakeFile, 'seed' | 'kdf' | 'key'>;
    if (cached.seed !== file.seed || JSON.stringify(cached.kdf) !== JSON.stringify(file.kdf)) {
      fail({ kind: 'CachedKeyStale' });
    }
    if (!sameKey(cached.key, file.key)) fail({ kind: 'WrongKey' });
    return new FakeUnlockedDatabase(file);
  }
}

class FakeUnlockedDatabase {
  readonly #info: DatabaseInfo;
  #freed = false;

  constructor(file: FakeFile) {
    this.#info = {
      name: file.name,
      rootGroup: '7f6b2a3c-0000-4000-8000-000000000001',
      recycleBinEnabled: true,
      formatVersion: file.formatVersion,
    };
  }

  info(): DatabaseInfo {
    this.#throwIfFreed();
    return { ...this.#info };
  }

  free(): void {
    this.#throwIfFreed();
    this.#freed = true;
  }

  /**
   * What wasm-bindgen throws for `info()` or a second `free()` on a freed handle: an Error, not a
   * CoreError.
   */
  #throwIfFreed(): void {
    if (this.#freed) throw new Error('null pointer passed to rust');
  }

  [Symbol.dispose](): void {
    this.free();
  }
}

/** The Composite key as the Core reads the components, in their order (core-api.md § 3). */
function fakeKeyOf(components: KeyComponent[]): FakeKey {
  const key: FakeKey = {};
  for (const component of components) {
    switch (component.kind) {
      case 'Password':
        if (key.password !== undefined) fail({ kind: 'Internal' });
        if (!isUtf8(component.value)) fail({ kind: 'WrongKey' });
        key.password = hex(component.value);
        break;
      case 'KeyFile':
        if (key.keyFile !== undefined) fail({ kind: 'Internal' });
        key.keyFile = hex(component.bytes);
        break;
      case 'ChallengeResponse':
        fail({ kind: 'WrongKey' });
    }
  }
  if (key.password === undefined && key.keyFile === undefined) fail({ kind: 'WrongKey' });
  return key;
}

function sameKey(a: FakeKey, b: FakeKey): boolean {
  return a.password === b.password && a.keyFile === b.keyFile;
}

function isUtf8(bytes: Uint8Array): boolean {
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return true;
  } catch {
    return false;
  }
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** Throws a `CoreError` value, as the bindings do (core-api.md § 8). */
function fail(error: CoreError): never {
  // eslint-disable-next-line @typescript-eslint/only-throw-error -- the bindings throw CoreError values, not Errors
  throw error;
}

function encode(marker: string, value: unknown): Uint8Array {
  return new TextEncoder().encode(marker + JSON.stringify(value));
}

/** The JSON behind `marker`, or `undefined` if the bytes do not start with it. */
function decode(marker: string, bytes: Uint8Array): { json: unknown } | 'incomplete' | undefined {
  const text = new TextDecoder().decode(bytes);
  if (!text.startsWith(marker)) return undefined;
  try {
    return { json: JSON.parse(text.slice(marker.length)) as unknown };
  } catch {
    return 'incomplete';
  }
}

function readFile(bytes: Uint8Array): FakeFile {
  const decoded = decode(fileMarker, bytes);
  if (decoded === undefined) fail({ kind: 'UnsupportedFile', reason: 'NotKdbx' });
  if (decoded === 'incomplete') fail({ kind: 'Corrupt', reason: 'Truncated' });
  // Only fakeDatabase writes this JSON.
  return decoded.json as FakeFile;
}
