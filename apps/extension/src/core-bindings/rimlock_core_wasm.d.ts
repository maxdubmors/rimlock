/* tslint:disable */
/* eslint-disable */
/**
 * Every way a Core call fails (`docs/spec/core-api.md` § 8): the value the bindings throw.
 */
export type CoreError = { kind: "WrongKey" } | { kind: "UnsupportedFile"; reason: string } | { kind: "Corrupt"; reason: string } | { kind: "CachedKeyStale" } | { kind: "ChallengeResponseRequired"; challenge: Uint8Array } | { kind: "RemoteKeyChanged" } | { kind: "NotFound"; uuid: string } | { kind: "EntryChanged"; uuid: string } | { kind: "InvalidChange"; reason: string } | { kind: "VerifyFailed" } | { kind: "Internal" };

/**
 * One part of the Composite key (`docs/spec/core-api.md` § 2). Secrets arrive as bytes, which
 * the caller wipes after the call.
 */
export type KeyComponent = { kind: "Password"; value: Uint8Array } | { kind: "KeyFile"; bytes: Uint8Array } | { kind: "ChallengeResponse"; response: Uint8Array };

/**
 * The KDBX version of a file (`docs/spec/core-api.md` § 2).
 */
export type FormatVersion = "3.1" | "4.0" | "4.1";

/**
 * The KDF and the parameters a settings screen would show (`docs/spec/core-api.md` § 2).
 */
export type KdfParameters = { kind: "Argon2d"; iterations: number; memoryBytes: number; parallelism: number } | { kind: "Argon2id"; iterations: number; memoryBytes: number; parallelism: number } | { kind: "AesKdf"; rounds: number };

/**
 * What `info()` returns (`docs/spec/core-api.md` § 4).
 */
export interface DatabaseInfo {
    name: string;
    rootGroup: string;
    recycleBinEnabled: boolean;
    recycleBin?: string;
    formatVersion: FormatVersion;
}

/**
 * What `readHeader` returns (`docs/spec/core-api.md` § 2).
 */
export interface HeaderInfo {
    formatVersion: FormatVersion;
    kdf: KdfParameters;
    /**
     * The KDF seed (in KDBX 3.1, the transform seed): what a challenge-response provider
     * answers for KDBX 4.x. Challenge-response is not supported for KDBX 3.1 (#80).
     */
    challenge: Uint8Array;
}

/**
 * What the Core says about itself (`docs/spec/core-api.md` § 3).
 */
export interface CoreInfo {
    version: string;
}


/**
 * One Unlocked Database, held by the background alone (`docs/spec/core-api.md` § 4).
 */
export class UnlockedDatabase {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    /**
     * The Database's name, root Group, Recycle Bin and format version.
     *
     * # Errors
     *
     * Only if `DatabaseInfo` cannot be converted to a JS value, which would be a bug in the bindings.
     */
    info(): DatabaseInfo;
}

/**
 * The Core's version and build facts; holds no state.
 *
 * # Errors
 *
 * Only if `CoreInfo` cannot be converted to a JS value, which would be a bug in the bindings.
 */
export function coreInfo(): CoreInfo;

/**
 * The KDBX version, the KDF and the challenge of a file, without a key.
 *
 * # Errors
 *
 * Throws `UnsupportedFile` or `Corrupt`.
 */
export function readHeader(bytes: Uint8Array): HeaderInfo;

/**
 * Decrypts a `.kdbx` with the given Composite key; runs the KDF.
 *
 * # Errors
 *
 * Throws `WrongKey` (also for any `ChallengeResponse` component), `UnsupportedFile` or
 * `Corrupt`; `Internal` for components that do not match `KeyComponent`, or for a second
 * password or Key file.
 */
export function unlock(bytes: Uint8Array, components: KeyComponent[]): UnlockedDatabase;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_unlockeddatabase_free: (a: number, b: number) => void;
    readonly coreInfo: () => [number, number, number];
    readonly readHeader: (a: number, b: number) => [number, number, number];
    readonly unlock: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly unlockeddatabase_info: (a: number) => [number, number, number];
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_exn_store: (a: number) => void;
    readonly __externref_table_alloc: () => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __externref_table_dealloc: (a: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
