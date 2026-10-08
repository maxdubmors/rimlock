# Core API and Source adapter contract

The contract between the Core (Rust, compiled to WASM) and the TypeScript side of the Extension, plus the contract every Source adapter implements. Agents implement both sides against this file; the `tsify`-generated types must match it. Signatures are written in TypeScript notation as TS sees them.

Decided in [Define the Core API and the Source adapter contract](https://github.com/maxdubmors/rimlock/issues/26). Principles: ADR-0003 (the split), ADR-0005 (rebuild on wake-up), ADR-0010 (interop write policies), ADR-0011 (key components, Source adapter), ADR-0014 (commits and statelessness).

## 1. Shape

- The WASM bindings crate exports **free functions** without state (`readHeader`, `unlock`, `open`) and one **handle class**, `UnlockedDatabase`, that holds the keepass-rs model of one Unlocked Database. Each method has its own input and output types.
- keepass-rs types never cross the seam.
- Only the background calls the Core, through a TS wrapper `CoreClient`. Popup, extension pages, content scripts and the Inline menu iframe never see Core types directly; they speak the background's own messaging protocol, which is a separate TS layer (it adds Auto-lock checks, Sync, pending saves).
- All calls are async from TS. Argon2 runs synchronously inside WASM and blocks the worker for ~0.7 s during `unlock` and `merge`; the UI shows a spinner. AES-KDF runs in WebCrypto through the keepass-rs KDF hook.
- Quick unlock adds no Core command (ADR-0012).

## 2. Shared types

```ts
type Uuid = string;                 // canonical lowercase hex with dashes
type Timestamp = string;            // ISO-8601 UTC, as stored in the Database

// Rust → TS: secrets leave the Core as UTF-8 bytes, never as `string`.
type SecretBytes = Uint8Array;

// TS-side wrapper. CoreClient wraps every SecretBytes immediately.
// toString / toJSON / util.inspect → "[Secret]".
// Only the messaging codec may encode it ({ $secret: base64 }).
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

type HeaderInfo = {
  formatVersion: '3.1' | '4.0' | '4.1';
  kdf: { kind: 'Argon2d' | 'Argon2id' | 'AesKdf'; /* parameters for display */ };
  challenge: Uint8Array;            // the KDF seed; what a challenge-response provider answers
};

// Result of every mutation (ADR-0014).
type Commit = {
  bytes: Uint8Array;                // the whole encrypted .kdbx, already verified
  created: Uuid[];                  // UUIDs of Entries/Groups created by this commit, in Change order
  cachedKey?: CachedKey;            // present only when the key material changed
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
```

- **Two-phase unlock is stateless.** TS calls `readHeader` for the challenge, asks a key-component provider when the Database is configured as using a hardware key (the KDBX header carries no marker), then calls `unlock` with all components. Nothing is held between the two calls, so a long wait for a YubiKey touch survives a worker teardown.
- In the MVP no provider exists, so a challenge-response Database fails with `WrongKey` (ADR-0011). Core tests use a software HMAC-SHA1 provider over `challenge` as the reference.
- `open` is the wake-up rebuild (ADR-0005). If the Local copy's KDF seed or parameters do not match the cache, it returns `CachedKeyStale` and the background locks.

## 4. `UnlockedDatabase`: reads

```ts
info(): DatabaseInfo;
entries(): EntrySummary[];                           // all of them, no secrets
groups(): GroupNode;                                 // the tree from the root, Recycle Bin included
search(query: string): Uuid[];                       // ranked; over every field incl. notes and protected ones
entry(uuid: Uuid): CoreResult<EntryView>;
historyEntry(uuid: Uuid, index: number): CoreResult<EntryView>;
reveal(uuid: Uuid, fieldKey: string, mode: 'raw' | 'resolved'): CoreResult<Secret>;
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
  formatVersion: '3.1' | '4.0' | '4.1';   // as read; saves are always 4.1 (ADR-0010)
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
  customFields: ({ key: string; protected: false; value: string } | { key: string; protected: true; hasValue: boolean })[];
  tags: string[];
  icon: Icon;
  expires?: Timestamp;
  times: { created: Timestamp; modified: Timestamp; locationChanged: Timestamp };
  totp?: { representations: { kind: TotpKind; sourceKey: string }[]; disagree: boolean };
  historyCount: number;
  matching: MatchingInfo;
};
type SecretField = { hasValue: boolean };   // value only through reveal()
type TotpKind = 'otp' | 'TimeOtp' | 'TrayTotp' | 'NotesUri';
```

- `reveal(…, 'raw')` serves the editor; `'resolved'` serves copy and display. `fill` always resolves. Resolution follows the placeholder allow-list (ADR-0010).
- `search` never says which field matched.
- `passwordEquals` compares in constant time and returns the UUIDs whose password equals the given one (Save prompt: "identical password → no prompt", "Update the Entry whose password equals current").
- No read changes the file: `LastAccessTime` and `UsageCount` stay untouched.

## 5. `UnlockedDatabase`: mutations

```ts
apply(changes: Change[]): Promise<CoreResult<Commit>>;
```

One entry point. All changes in one call are atomic: the Core applies them to a clone, serialises it, verifies it (§7), and only then swaps its state. One `apply` → one encryption → one `Commit`. Each Entry touched by one `UpdateEntry` gets exactly one history version.

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

- Edits are logical; the Core maps them to the keys, encodings and `Protected` flags already in the file (ADR-0010).
- `ifUnchangedSince` carries `times.modified` of the `EntryView` the draft was opened from. If the Entry changed since (typically through a Merge), the change fails with `EntryChanged`, and the UI offers "Overwrite" (resend without the condition) or "Discard my edits".
- `RecycleEntries` / `RecycleGroup` with `RecycleBinEnabled=false` fail with `InvalidChange { reason: 'RecycleBinDisabled' }`; the UI asks for confirmation and sends `DeleteEntries` / `DeleteGroup`. The Core never turns a recycle into a delete by itself. The Recycle Bin is created lazily, KeePass-style.
- Saves reuse the KDF seed and draw a fresh master seed (ADR-0005), so `Commit.cachedKey` is absent for ordinary edits.
- Not in the MVP: changing the Composite key, the KDF or other Database settings (do it in KeePassXC). The API leaves room for a `ChangeCompositeKey` change.

## 6. `UnlockedDatabase`: merge

```ts
merge(remoteBytes: Uint8Array, opts?: { components?: KeyComponent[] }): Promise<CoreResult<{
  commit?: Commit;                  // when the local side changed
  remoteNeedsWrite: boolean;        // the merged result differs from the remote → Sync writes it back
  cachedKey?: CachedKey;            // when a KDF seed or a key was adopted
  stats: { added: number; updated: number; deleted: number };
}>>;
```

- KeePassXC `Merger` semantics (ADR-0008). Used by WebDAV Sync, Chrome file Sync and Firefox Re-import….
- Without `components` the Core opens the remote with its own hashed Composite key; a different KDF seed costs one KDF run.
- If that key fails: `RemoteKeyChanged`. Sync stops pushing; the UI asks for the new key; TS calls `merge(remote, { components })`. The Local copy then takes the remote's key and encryption settings, and the result carries a new `cachedKey`.
- If the Database has a challenge-response component and the remote's KDF seed differs: `ChallengeResponseRequired { challenge }`. TS asks the provider and retries with `components` including the response. Stateless, like unlock.

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
- Error details carry only UUIDs, field keys and reason codes. The Rust secret types implement neither `Debug` nor `Display` with their content, so a secret cannot end up in an error or a log.
- A panic aborts the WASM instance. `CoreClient` marks it dead (`CoreUnavailable`), and the background rebuilds it from the Local copy as on wake-up.

## 9. `CoreClient` rules (TS, background only)

- One queue: calls on a handle never run concurrently.
- Every `SecretBytes` is wrapped into a `Secret` on arrival; every `Secret` input is unwrapped only at the call.
- **The Local copy is the source of truth; the in-memory Database is its cache.** A `Commit` is stored atomically in IndexedDB before the result is reported as saved. If storing fails, the handle is dropped and rebuilt from the Local copy; the edit is lost and the user sees an error.
- A new `cachedKey` in any result replaces the one in `storage.session` at once (this is also the single restore point of ADR-0012).

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

- `write` enforces the conditions of its Source: for WebDAV a fresh ETag check, an `If-Match`-style condition and temp + `MOVE` (ADR-0008); for a Chrome file a `lastModified`/`size` check (ADR-0007). A changed remote returns `conflict`.
- `permission-needed`: Chrome needs a user gesture in the popup to regain file access.
- Adapters do bytes only. Merge-before-write and Sync live above them in a TS `Sync` module, which calls `stat`/`read`, `CoreClient.merge`, and `write`.
- Adapters exist only for live Sources: Chrome local file, WebDAV, and later the Companion. A Firefox imported file is not an adapter: Re-import… hands the chosen file's bytes to `merge`, and Export… saves the Local copy's bytes.

## 11. Flows

- **Unlock:** popup sends components → background: Local copy (or Source read on first add) → `readHeader` → provider if configured → `unlock` → store `cachedKey` in `storage.session`.
- **Wake-up:** `open(localCopy, cachedKey)`; `CachedKeyStale` → lock.
- **Edit:** `apply([...])` → store `Commit` in the Local copy → Sync pushes when it can.
- **Sync:** `stat`; if the version differs from the last synced one: `read` → `merge` → store `commit` if any → `write(bytes, version)` if `remoteNeedsWrite` or Pending changes; `conflict` → start over.
- **Key changed elsewhere:** `RemoteKeyChanged` → push stops → user enters the new key → `merge` with `components`.
