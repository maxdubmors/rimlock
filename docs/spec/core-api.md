# Core API and Source adapter contract

The contract between the Core (Rust, compiled to WASM) and the TypeScript side of the Extension, plus the contract every Source adapter implements. Agents implement both sides against this file; the `tsify`-generated types must match it. Signatures are written in TypeScript notation as TS sees them.

Decided in [Define the Core API and the Source adapter contract](https://github.com/maxdubmors/rimlock/issues/26); history reads and reserved custom-field keys added in [Decide the editing flows for Entries and Groups](https://github.com/maxdubmors/rimlock/issues/28); the write order of a `Commit` and its `cachedKey` in [Stale CachedKey on wake-up: lock, or rebuild from the hashed Composite key (ADR-0005)?](https://github.com/maxdubmors/rimlock/issues/87); the shape of the `merge` result in [Can merge return a cachedKey without a commit?](https://github.com/maxdubmors/rimlock/issues/90); a call on a freed handle in [What does CoreClient answer for a call on a freed UnlockedDatabase?](https://github.com/maxdubmors/rimlock/issues/94). Principles: ADR-0003 (the split), ADR-0005 (rebuild on wake-up), ADR-0010 (interop write policies), ADR-0011 (key components, Source adapter), ADR-0014 (commits and statelessness).

## 1. Shape

- The WASM bindings crate exports **free functions** without state (`coreInfo`, `readHeader`, `unlock`, `open`) and one **handle class**, `UnlockedDatabase`, that holds the keepass-rs model of one Unlocked Database. Each method has its own input and output types.
- keepass-rs types never cross the seam.
- Only the background calls the Core, through a TS wrapper `CoreClient`. Popup, extension pages, content scripts and the Inline menu iframe never see Core types directly; they speak the background's own messaging protocol, which is a separate TS layer (it adds Auto-lock checks, Sync, pending saves).
- All calls are async from TS. Argon2 runs synchronously inside WASM and blocks the worker for ~0.7 s during `unlock` and `merge`; the UI shows a spinner. AES-KDF runs in WebCrypto through the Core's injected `Kdf` (§ 3), so no keepass-rs hook is needed.
- Quick unlock adds no Core command (ADR-0012).

## 2. Shared types

```ts
type Uuid = string;                 // canonical lowercase hex with dashes
type Timestamp = string;            // ISO-8601 UTC, as stored in the Database

// Rust → TS: secrets leave the Core as UTF-8 bytes, never as `string`.
type SecretBytes = Uint8Array;

// TS-side wrapper. CoreClient wraps every SecretBytes immediately.
// toString / toJSON / util.inspect → "[Secret]".
// Only the messaging codec may encode it ({ $secret: base64 }): in a message, or as the CachedKey in storage.session.
declare class Secret {
  reveal(): string;
  wipe(): void;                     // best effort: zero the bytes
}

// Opaque, versioned key material for storage.session (ADR-0005):
// the hashed Composite key plus the transformed-key cache tied to KDF seed and parameters.
// TS stores it as is, wrapped in a Secret, and never parses it.
type CachedKey = SecretBytes;

type KeyComponent =
  | { kind: 'Password'; value: Secret }
  | { kind: 'KeyFile'; bytes: Uint8Array }
  | { kind: 'ChallengeResponse'; response: SecretBytes };   // e.g. YubiKey via the Companion

type FormatVersion = '3.1' | '4.0' | '4.1';

// The KDF and the parameters a settings screen shows.
type KdfParameters =
  | { kind: 'Argon2d'; iterations: number; memoryBytes: number; parallelism: number }
  | { kind: 'Argon2id'; iterations: number; memoryBytes: number; parallelism: number }
  | { kind: 'AesKdf'; rounds: number };

type HeaderInfo = {
  formatVersion: FormatVersion;
  kdf: KdfParameters;
  challenge: Uint8Array;            // the KDF seed (3.1: the transform seed); what a challenge-response provider answers
                                    // for KDBX 4.x; challenge-response is not supported for KDBX 3.1 (#80, § 3)
};

// Result of every mutation (ADR-0014).
type Commit = {
  bytes: Uint8Array;                // the whole encrypted .kdbx, already verified
  created: Uuid[];                  // UUIDs of Entries/Groups created by this commit, in Change order
  cachedKey?: CachedKey;            // present only when the key material changed: a merge that adopted a KDF seed or a key
};
```

The `revision` used for Pending changes is assigned by the TS Local copy store, not by the Core: it increments on every stored `Commit`, and Sync remembers `lastSyncedRevision`. Pending changes = `revision ≠ lastSyncedRevision`.

## 3. Unlock and rebuild (free functions)

```ts
readHeader(bytes: Uint8Array): CoreResult<HeaderInfo>;

unlock(bytes: Uint8Array, components: KeyComponent[])
  : Promise<CoreResult<{ db: UnlockedDatabase; cachedKey: CachedKey }>>;   // runs the KDF

open(localCopyBytes: Uint8Array, cachedKey: CachedKey)
  : Promise<CoreResult<UnlockedDatabase>>;                                 // never runs the KDF

declare class UnlockedDatabase { free(): void }   // the handle: §§ 4–6 are its methods; free() drops the Database, and § 9 says what a later call gets
```

```ts
coreInfo(): CoreInfo;                                                      // holds no state; throws only if the bindings are broken

type CoreInfo = { version: string };   // the rimlock-core crate version
```

- `coreInfo` answers the background's `status` message, so a test can check which Core the store bundle runs.
- **Two-phase unlock is stateless.** TS calls `readHeader` for the challenge, asks a key-component provider when the Database is configured as using a hardware key (the KDBX header carries no marker), then calls `unlock` with all components. Nothing is held between the two calls, so a long wait for a YubiKey touch survives a worker teardown.
- In the MVP no provider exists, so a challenge-response Database fails with `WrongKey` (ADR-0011). Core tests use a software HMAC-SHA1 provider over `challenge` as the reference.
- Challenge-response is not supported for KDBX 3.1, now or after the Companion: KeePassXC challenges the master seed there, not `challenge`, and hashes the response in after the KDF, so it would need a second key shape in the `CachedKey` ([#80](https://github.com/maxdubmors/rimlock/issues/80)). A `ChallengeResponse` component on a 3.1 file is `WrongKey`; the user converts the file to KDBX 4 in KeePassXC.
- `unlock` reads the header as `readHeader` does first, so a file `readHeader` rejects fails `unlock` with the same error. No components, a password that is not UTF-8, or a Key file that does not parse, is `WrongKey` too (KeePass hashes any bytes as a Key file). A second `Password` or `KeyFile` component is `Internal`, a bug in the caller.
- The bindings are synchronous, like every binding: `CoreClient` makes the calls async.
- `open` is the wake-up rebuild (ADR-0005). If the Local copy's KDF seed or parameters do not match the cache, it returns `CachedKeyStale` and the background locks. A `CachedKey` of another format version, as after an update that changed it, is `CachedKeyStale` too; one from another Database is `CachedKeyStale` or `WrongKey`.
- `open` never reads the hashed Composite key in the `CachedKey` and never runs the KDF. The hashed Composite key is there for `merge` (§ 6): it opens a remote that another client saved with a fresh KDF seed, without the Master password, at one KDF run. A `CachedKeyStale` on wake-up therefore means the Local copy and `storage.session` are out of step (§ 9), or the `CachedKey` format changed, and the background locks.
- The Core runs the KDF itself, behind an injected `Kdf`, and keepass-rs decrypts with the transformed key, so `open` cannot run it: Core tests hand `open` a KDF that fails if called.
- The `CachedKey` binds the Argon2 version too, so `readHeader` reads it: a missing one, or one other than `0x10` and `0x13`, is `Corrupt { reason: 'KdfParameters' }`, as keepass-rs rejects it. `HeaderInfo` leaves it out.

## 4. `UnlockedDatabase`: reads

```ts
info(): DatabaseInfo;
entries(): EntrySummary[];                           // all of them, no secrets
groups(): GroupNode;                                 // the tree from the root, Recycle Bin included
search(query: string): Uuid[];                       // ranked; over every field incl. notes and protected ones
entry(uuid: Uuid): CoreResult<EntryView>;
history(uuid: Uuid): CoreResult<HistoryVersion[]>;  // oldest first; index = position in this list
historyEntry(uuid: Uuid, index: number): CoreResult<EntryView>;
reveal(uuid: Uuid, fieldKey: string, mode: 'raw' | 'resolved', historyIndex?: number): CoreResult<Secret>;
fill(uuid: Uuid, fields: ('username' | 'password' | 'totp')[])
  : CoreResult<{ username?: Secret; password?: Secret; totp?: Secret }>;
totp(uuid: Uuid): CoreResult<{ code: Secret; period: number; validUntil: Timestamp }>;
totpCandidates(uuid: Uuid): CoreResult<{ kind: TotpKind; sourceKey: string; code: Secret }[]>;
passwordEquals(uuids: Uuid[], password: Secret): Uuid[];
```

```ts
type DatabaseInfo = {
  name: string;
  rootGroup: Uuid;
  recycleBinEnabled: boolean;
  recycleBin?: Uuid;
  formatVersion: FormatVersion;      // as read; saves are always 4.1 (ADR-0010)
};

type EntrySummary = {
  uuid: Uuid;
  title: string;
  username: string;                  // not a secret (ADR-0003)
  groupPath: string[];
  tags: string[];
  icon: Icon;
  hasTotp: boolean;
  expired: boolean;
  inRecycleBin: boolean;
  matching: MatchingInfo;
};

type MatchingInfo = {
  urls: { url: string; sourceKey: string }[];   // URL, KP2A_URL*, URL_n, URL-*, "URL <n>", Kee altUrls; {REF} resolved
  hiddenBy: OptOut[];                           // empty = may be offered
};

type OptOut =
  | { kind: 'BrowserHideEntry' }                      // the only writable one
  | { kind: 'GroupSetting'; group: Uuid }             // KeePassXC Group tri-state
  | { kind: 'KeePassXCDeny'; hosts: string[] }        // hides only on these hosts
  | { kind: 'Strongbox' }                             // KPEX_DoNotSuggestForAutoFill
  | { kind: 'KeeHide' }
  | { kind: 'KeeBlockedUrls'; urls: string[] }        // hides only on these URLs
  | { kind: 'HttpAuthOnly' }                          // BrowserOnlyHttpAuth
  | { kind: 'RecycleBin' };

type GroupNode = { uuid: Uuid; name: string; icon: Icon; isRecycleBin: boolean; children: GroupNode[] };

type EntryView = {
  uuid: Uuid;
  group: Uuid;
  title: string;
  username: string;
  password: SecretField;
  notes: SecretField;
  url?: { url: string; sourceKey: string };
  additionalUrls: { url: string; sourceKey: string }[];   // the editor shows one list without keys
  customFields: (                                         // excludes keys rimlock interprets (URL, TOTP and Kee keys)
               { key: string; protected: false; value: string } | { key: string; protected: true; hasValue: boolean })[];
  tags: string[];
  icon: Icon;
  expires?: Timestamp;
  times: { created: Timestamp; modified: Timestamp; locationChanged: Timestamp };
  totp?: { representations: { kind: TotpKind; sourceKey: string }[]; disagree: boolean };
  historyCount: number;
  matching: MatchingInfo;
};
type SecretField = { hasValue: boolean };   // value only through reveal()

type HistoryVersion = {
  index: number;
  modified: Timestamp;
  changed: string[];                // field keys that differ from the next version (or the current one); secret fields included, values never
};
type TotpKind = 'otp' | 'TimeOtp' | 'TrayTotp' | 'NotesUri';
```

- `history` lists the versions with the names of the fields each one changed, so the History list needs no secrets. `reveal` with `historyIndex` reads a field of that version ("what was my old password?").
- `reveal(…, 'raw')` serves the editor; `'resolved'` serves copy and display. `fill` always resolves. Resolution follows the placeholder allow-list (ADR-0010).
- `search` never says which field matched.
- `passwordEquals` compares in constant time and returns the UUIDs whose password equals the given one (Save prompt: "identical password → no prompt", "Update the Entry whose password equals current").
- No read changes the file: `LastAccessTime` and `UsageCount` stay untouched.

## 5. `UnlockedDatabase`: mutations

```ts
apply(changes: Change[]): Promise<CoreResult<Commit>>;
```

One entry point. All changes in one call are atomic: the Core applies them to a clone, serialises it, verifies it (§ 7), and only then swaps its state. One `apply` → one encryption → one `Commit`. Each Entry touched by one `UpdateEntry` gets exactly one history version.

```ts
type Change =
  | { kind: 'UpdateEntry'; uuid: Uuid; ifUnchangedSince?: Timestamp; edits: EntryEdit[] }
  | { kind: 'CreateEntry'; group: Uuid; edits: EntryEdit[] }
  | { kind: 'MoveEntries'; uuids: Uuid[]; to: Uuid }
  | { kind: 'RecycleEntries'; uuids: Uuid[] }
  | { kind: 'DeleteEntries'; uuids: Uuid[] }            // permanent; adds DeletedObjects
  | { kind: 'RestoreEntries'; uuids: Uuid[] }           // to PreviousParentGroup, else the root
  | { kind: 'EmptyRecycleBin' }
  | { kind: 'CreateGroup'; parent: Uuid; name: string }
  | { kind: 'RenameGroup'; uuid: Uuid; name: string }
  | { kind: 'MoveGroup'; uuid: Uuid; to: Uuid }
  | { kind: 'RecycleGroup'; uuid: Uuid }
  | { kind: 'DeleteGroup'; uuid: Uuid }
  | { kind: 'RestoreGroup'; uuid: Uuid }
  | { kind: 'RestoreHistoryVersion'; uuid: Uuid; index: number }   // current version goes to history
  | { kind: 'DeleteHistoryVersion'; uuid: Uuid; index: number };

type EntryEdit =
  | { kind: 'SetField'; field: 'title' | 'username' | 'url'; value: string }
  | { kind: 'SetField'; field: 'password' | 'notes'; value: Secret }
  | { kind: 'AddUrl'; url: string }                          // first free KP2A_URL*
  | { kind: 'EditUrl'; sourceKey: string; url: string }      // keeps its key
  | { kind: 'RemoveUrl'; sourceKey: string }                 // shifts later URL_n down
  | { kind: 'SetCustomField'; key: string; value: string | Secret; protected: boolean }
  | { kind: 'RenameCustomField'; from: string; to: string }
  | { kind: 'RemoveCustomField'; key: string }
  | { kind: 'SetTotp'; otpauth: Secret }                     // rewrites every representation, adds otp + TimeOtp-Secret-Base32
  | { kind: 'RemoveTotp' }
  | { kind: 'UseTotpRepresentation'; sourceKey: string }     // rewrites the others from this one
  | { kind: 'SetTags'; tags: string[] }                      // unchanged set → Tags text byte-identical
  | { kind: 'SetIcon'; icon: number }                        // standard icon id
  | { kind: 'SetExpiry'; expires: Timestamp | null }
  | { kind: 'SetBrowserHidden'; hidden: boolean };           // writes or removes BrowserHideEntry only
```

- `SetCustomField` / `RenameCustomField` to a standard key (`Title`, `UserName`, `Password`, `URL`, `Notes`), a key rimlock interprets (`KP2A_URL*`, `URL_n`, `URL-*`, `URL <n>`, `otp`, `TimeOtp-*`, `TOTP Seed`, `TOTP Settings`, `KPRPC JSON`) or an existing key fails with `InvalidChange { reason: 'ReservedKey' | 'DuplicateKey' }`.
- Edits are logical; the Core maps them to the keys, encodings and `Protected` flags already in the file (ADR-0010).
- `ifUnchangedSince` carries `times.modified` of the `EntryView` the draft was opened from. If the Entry changed since (typically through a Merge), the change fails with `EntryChanged`, and the UI offers "Overwrite" (resend without the condition; the other version stays in history), "Discard my edits" or "Show their version". If a Merge deleted or recycled the Entry, the UI offers "Save as new Entry" (`CreateEntry`) or "Discard".
- `RecycleEntries` / `RecycleGroup` with `RecycleBinEnabled=false` fail with `InvalidChange { reason: 'RecycleBinDisabled' }`; the UI asks for confirmation and sends `DeleteEntries` / `DeleteGroup`. The Core never turns a recycle into a delete by itself. The Recycle Bin is created lazily, KeePass-style.
- Saves reuse the KDF seed and draw a fresh master seed (ADR-0005), so `Commit.cachedKey` is absent for ordinary edits.
- Not in the MVP: changing the Composite key, the KDF or other Database settings (do it in KeePassXC). The API leaves room for a `ChangeCompositeKey` change.

## 6. `UnlockedDatabase`: merge

```ts
merge(remoteBytes: Uint8Array, opts?: { components?: KeyComponent[] }): Promise<CoreResult<{
  commit?: Commit;                  // when the local side changed
  remoteNeedsWrite: boolean;        // the merged result differs from the remote → Sync writes it back
  stats: { added: number; updated: number; deleted: number };
}>>;
```

- KeePassXC `Merger` semantics (ADR-0008). Used by WebDAV Sync, Chrome file Sync and Firefox Re-import….
- Without `components` the Core opens the remote with its own hashed Composite key; a different KDF seed costs one KDF run.
- If that key fails: `RemoteKeyChanged`. Sync stops pushing; the UI asks for the new key; TS calls `merge(remote, { components })`. The Local copy then takes the remote's key and encryption settings, and the `commit` carries a new `cachedKey`.
- Adopting a KDF seed or a key changes the Local copy, so `merge` returns its new `cachedKey` only in `Commit.cachedKey`.
- If the Database has a challenge-response component and the remote's KDF seed differs: `ChallengeResponseRequired { challenge }`. TS asks the provider and retries with `components` including the response. Stateless, like unlock. KDBX 4.x only: challenge-response is not supported for a KDBX 3.1 remote, whose challenge is the master seed ([#80](https://github.com/maxdubmors/rimlock/issues/80)).

## 7. Verify-on-commit

Before returning a `Commit` (from `apply` or `merge`), the Core decrypts the bytes it just produced with the cached transformed key, parses them, and compares a digest of the resulting model with the expected one. On mismatch it returns `VerifyFailed` and keeps its previous state.

## 8. Errors

```ts
type CoreError =
  | { kind: 'WrongKey' }
  | { kind: 'UnsupportedFile'; reason: string }          // reason is a code, never content
  | { kind: 'Corrupt'; reason: string }
  | { kind: 'CachedKeyStale' }
  | { kind: 'ChallengeResponseRequired'; challenge: Uint8Array }
  | { kind: 'RemoteKeyChanged' }
  | { kind: 'NotFound'; uuid: Uuid }
  | { kind: 'EntryChanged'; uuid: Uuid }
  | { kind: 'InvalidChange'; reason: string }
  | { kind: 'VerifyFailed' }
  | { kind: 'Internal' };

type CoreResult<T> = { ok: true; value: T } | { ok: false; error: CoreError | { kind: 'CoreUnavailable' } };
```

- Rust returns `Result<T, CoreError>`; wasm-bindgen throws the error; `CoreClient` catches it and returns a `CoreResult`. Callers use an exhaustive `switch`, not try/catch.
- Reason codes: `UnsupportedFile` is `NotKdbx`, `Kdb` (KeePass 1), `FormatVersion`, `Cipher`, `Compression` or `Kdf`; `Corrupt` is `Truncated`, `Header`, `KdfParameters`, `HeaderHash`, `Payload` or `Xml`; `InvalidChange` is `ReservedKey`, `DuplicateKey` or `RecycleBinDisabled`. A KDBX 3.1 file has no header HMAC, so a damaged 3.1 payload can read as `WrongKey`.
- `readHeader`, `unlock` and the handle's methods throw a `CoreError` value for every failure; input that does not match the declared types (a bug in `CoreClient`) is `Internal`. Only a broken binding throws anything else, as `coreInfo` does.
- Error details carry only UUIDs, field keys and reason codes. The Rust secret types implement neither `Debug` nor `Display` with their content, so a secret cannot end up in an error or a log.
- A panic aborts the WASM instance. `CoreClient` marks it dead (`CoreUnavailable`), and the background rebuilds it from the Local copy as on wake-up.

## 9. `CoreClient` rules (TS, background only)

- One queue: calls on a handle never run concurrently.
- A method called on a handle after its `free()` is `Internal`, a bug in the caller: `CoreClient` answers it without reaching the Core, so the Core stays usable. The bindings would throw a plain `Error` there, which § 8 reads as a panic. A second `free()` does nothing.
- Every `SecretBytes` is wrapped into a `Secret` on arrival; every `Secret` input is unwrapped only at the call, into its UTF-8 bytes, and wiped after it. The generated bindings therefore take `SecretBytes` wherever this file says `Secret` (`KeyComponent`'s `Password` is `{ kind: 'Password'; value: SecretBytes }`).
- The order of storing a `Commit` and reporting its result, and what a failed store does: [`sources.md`](sources.md) § The Local copy.
- A new `cachedKey` replaces the one in `storage.session` through the single restore point of ADR-0012. One in a `Commit` (of `apply` or `merge`) replaces it only after the `Commit` is stored in the Local copy. If storing the `Commit` fails, the old `cachedKey` stays, and the rebuild from the Local copy uses it. The `cachedKey` of `unlock` comes without a `Commit` and is stored as soon as it arrives. Apart from an update that changed the `CachedKey` format, the only way to a stale `CachedKey` is then the background dying between the two writes, and that locks (§ 11).

## 10. Source adapter (TS)

```ts
interface SourceAdapter {
  stat(): Promise<SourceResult<Version>>;                       // cheap: lastModified/size or ETag (PROPFIND)
  read(): Promise<SourceResult<{ bytes: Uint8Array; version: Version }>>;
  write(bytes: Uint8Array, ifVersion: Version): Promise<SourceResult<Version>>;
  watch?(onChange: () => void): () => void;                     // Chrome FileSystemObserver; later the Companion
}

type Version = { readonly token: string };                      // opaque, compared only for equality
type SourceError = 'offline' | 'not-found' | 'auth' | 'permission-needed' | 'conflict';
type SourceResult<T> = { ok: true; value: T } | { ok: false; error: SourceError };
```

- `write` enforces the conditions of its Source: for WebDAV a fresh ETag check, an `If-Match`-style condition and temp + `MOVE` (ADR-0008; the steps, and the failed condition on an unchanged file: [`sources.md`](sources.md) § WebDAV, Writes); for a Chrome file a `lastModified`/`size` check (ADR-0007; [`sources.md`](sources.md) § Chrome: local file, Concurrent writers). A changed remote returns `conflict`.
- `permission-needed`: Chrome needs a user gesture in the popup to regain file access.
- Adapters do bytes only. Merge-before-write and Sync live above them in a TS `Sync` module, which calls `stat`/`read`, `CoreClient.merge`, and `write`.
- Adapters exist only for live Sources: Chrome local file, WebDAV, and later the Companion. A Firefox imported file is not an adapter; what Re-import… and Export… do with its bytes: [`sources.md`](sources.md) § Firefox: imported copy.

## 11. Flows

- **Unlock:** popup sends components → background: Local copy (or Source read on first add) → `readHeader` → provider if configured → `unlock` → store `cachedKey` in `storage.session`.
- **Wake-up:** `open(localCopy, cachedKey)`; `CachedKeyStale` → lock.
- **Edit:** `apply([...])` → store `Commit` in the Local copy → Sync pushes when it can.
- **Sync:** `stat`; if the version differs from the last synced one: `read` → `merge` → store `commit` if any, then its `Commit.cachedKey` if any (§ 9) → `write(bytes, version)` if `remoteNeedsWrite` or there were Pending changes before the merge; otherwise mark the Local copy synced with the remote version without writing (a merge commit alone is not a Pending change); `conflict` → start over. Full loop: [`sources.md`](sources.md) § Sync.
- **Key changed elsewhere:** `RemoteKeyChanged` → push stops → user enters the new key → `merge` with `components` → store the `commit`, then its new `Commit.cachedKey` (§ 9).
