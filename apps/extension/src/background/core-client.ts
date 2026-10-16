// The one way background code calls the Core (docs/spec/core-api.md § 1, § 9). It makes every
// call async, turns what the bindings throw into a `CoreResult`, and keeps secrets in `Secret`.

import type * as Bindings from '../core-bindings/rimlock_core_wasm.js';
import type {
  CoreError,
  CoreInfo,
  DatabaseInfo,
  HeaderInfo,
  KeyComponent as BoundKeyComponent,
  UnlockedDatabase as BoundDatabase,
} from '../core-bindings/rimlock_core_wasm.js';
import type { Result } from '../shared/result';
import { exposeSecret, Secret } from '../shared/secret';

/** What `CoreClient` calls: the generated bindings, or `FakeCore`. */
export type CoreBindings = Pick<typeof Bindings, 'coreInfo' | 'readHeader' | 'unlock' | 'open'>;

/** The Core cannot answer: it failed to instantiate, or a panic aborted it (core-api.md § 8). */
export type CoreUnavailable = { kind: 'CoreUnavailable' };

/** core-api.md § 8. */
export type CoreResult<T> = Result<T, CoreError | CoreUnavailable>;

/**
 * One part of the Composite key (core-api.md § 2). The bindings take the Master password as UTF-8
 * bytes; `CoreClient` unwraps it only at the call.
 */
export type KeyComponent =
  | { kind: 'Password'; value: Secret }
  | { kind: 'KeyFile'; bytes: Uint8Array }
  | { kind: 'ChallengeResponse'; response: Uint8Array };

/** Opaque key material for `storage.session` (ADR-0005), never parsed outside the Core. */
export type CachedKey = Secret;

const unavailable = { ok: false, error: { kind: 'CoreUnavailable' } } as const;

export class CoreClient {
  readonly #load: () => Promise<CoreBindings>;
  #loading: Promise<CoreBindings> | undefined;
  /** A panic aborted the WASM instance: nothing reaches it again (core-api.md § 8). */
  #dead = false;

  /**
   * `load` instantiates the Core. A failed attempt is forgotten, so the next call retries.
   */
  constructor(load: () => Promise<CoreBindings>) {
    this.#load = load;
  }

  /**
   * The Core's version. It holds no state, so any failure means the bindings are broken: the
   * instance is dead (core-api.md § 3).
   */
  async coreInfo(): Promise<Result<CoreInfo, CoreUnavailable>> {
    const result = await this.#call((core) => core.coreInfo());
    if (result.ok) return result;
    // A failed instantiation is retried; a CoreError from the bindings means they are broken.
    if (result.error.kind !== 'CoreUnavailable') this.#dead = true;
    return unavailable;
  }

  readHeader(bytes: Uint8Array): Promise<CoreResult<HeaderInfo>> {
    return this.#call((core) => core.readHeader(bytes));
  }

  /** Decrypts a `.kdbx` with the Composite key; runs the KDF. */
  unlock(
    bytes: Uint8Array,
    components: KeyComponent[],
  ): Promise<CoreResult<{ db: UnlockedDatabase; cachedKey: CachedKey }>> {
    return this.#call((core) => {
      const bound = components.map(unwrap);
      try {
        const unlocked = core.unlock(bytes, bound);
        return { db: this.#wrap(unlocked.db), cachedKey: new Secret(unlocked.cachedKey) };
      } finally {
        bound.forEach(wipeUnwrapped);
      }
    });
  }

  /** Rebuilds the Unlocked Database from the Local copy (ADR-0005); never runs the KDF. */
  open(localCopyBytes: Uint8Array, cachedKey: CachedKey): Promise<CoreResult<UnlockedDatabase>> {
    return this.#call((core) => {
      const key = exposeSecret(cachedKey);
      try {
        return this.#wrap(core.open(localCopyBytes, key));
      } finally {
        key.fill(0);
      }
    });
  }

  #wrap(db: BoundDatabase): UnlockedDatabase {
    return new UnlockedDatabase(db, (run) => this.#call(run));
  }

  /**
   * Runs one Core call. Whatever is not a `CoreError` comes from a panic or a broken binding,
   * so the instance is dead.
   */
  async #call<T>(run: (core: CoreBindings) => T | Promise<T>): Promise<CoreResult<T>> {
    if (this.#dead) return unavailable;
    let core: CoreBindings;
    try {
      core = await this.#loaded();
    } catch {
      return unavailable;
    }
    try {
      return { ok: true, value: await run(core) };
    } catch (thrown) {
      const error = parseCoreError(thrown);
      if (error !== undefined) return { ok: false, error };
      this.#dead = true;
      return unavailable;
    }
  }

  #loaded(): Promise<CoreBindings> {
    this.#loading ??= this.#load().catch((error: unknown) => {
      this.#loading = undefined;
      throw error;
    });
    return this.#loading;
  }
}

/**
 * One Unlocked Database, the handle the Core holds it in (core-api.md § 1). Only `CoreClient`
 * makes one.
 */
class UnlockedDatabase {
  readonly #db: BoundDatabase;
  readonly #call: Call;
  /** Settles when the last call made on this handle has finished. */
  #queue: Promise<unknown> = Promise.resolve();
  #freed = false;

  constructor(db: BoundDatabase, call: Call) {
    this.#db = db;
    this.#call = call;
  }

  info(): Promise<CoreResult<DatabaseInfo>> {
    return this.#run(() => this.#db.info());
  }

  /** Drops the Database from the Core's memory; the handle answers `Internal` afterwards. */
  async free(): Promise<void> {
    await this.#run(() => {
      this.#freed = true;
      this.#db.free();
    });
  }

  /**
   * Queues one call behind the ones made before it, so calls on the handle never run
   * concurrently (core-api.md § 9). A call on a freed handle, a bug in the caller, would reach a
   * freed Rust object: it is `Internal` instead.
   */
  #run<T>(run: () => T): Promise<CoreResult<T>> {
    const result = this.#queue.then((): Promise<CoreResult<T>> =>
      this.#freed ? Promise.resolve({ ok: false, error: { kind: 'Internal' } }) : this.#call(run),
    );
    this.#queue = result;
    return result;
  }
}

/** `CoreClient`'s way into the Core, for the handles it makes. */
type Call = <T>(run: () => T | Promise<T>) => Promise<CoreResult<T>>;

export type { UnlockedDatabase };

function unwrap(component: KeyComponent): BoundKeyComponent {
  return component.kind === 'Password'
    ? { kind: 'Password', value: exposeSecret(component.value) }
    : component;
}

/** Zeroes the bytes `unwrap` took out of a Secret, once the call has them. */
function wipeUnwrapped(component: BoundKeyComponent): void {
  if (component.kind === 'Password') component.value.fill(0);
}

/** The `CoreError` a Core call threw, rebuilt, or `undefined` for anything else. */
function parseCoreError(thrown: unknown): CoreError | undefined {
  if (typeof thrown !== 'object' || thrown === null) return undefined;
  const fields = thrown as Record<string, unknown>;
  const kind = fields['kind'] as CoreError['kind'];
  switch (kind) {
    case 'WrongKey':
    case 'CachedKeyStale':
    case 'RemoteKeyChanged':
    case 'VerifyFailed':
    case 'Internal':
      return { kind };
    case 'UnsupportedFile':
    case 'Corrupt':
    case 'InvalidChange': {
      const reason = fields['reason'];
      return typeof reason === 'string' ? { kind, reason } : undefined;
    }
    case 'NotFound':
    case 'EntryChanged': {
      const uuid = fields['uuid'];
      return typeof uuid === 'string' ? { kind, uuid } : undefined;
    }
    case 'ChallengeResponseRequired': {
      const challenge = fields['challenge'];
      return challenge instanceof Uint8Array ? { kind, challenge } : undefined;
    }
    default:
      return undefined;
  }
}
