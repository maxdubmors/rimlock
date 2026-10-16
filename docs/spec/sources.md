# Sources, the Local copy and Sync

Principles: [ADR-0005](../adr/0005-unlocked-state-rebuilt-on-every-wake-up.md) (Local copy, commit at once), [ADR-0007](../adr/0007-local-file-source-per-browser.md) (local file per browser), [ADR-0008](../adr/0008-webdav-source-always-merge.md) (WebDAV: always merge), [ADR-0014](../adr/0014-core-mutations-return-the-verified-file.md) (the Local copy is the truth). Contract: [`core-api.md`](core-api.md) §6, §10, §11.

## The Local copy

- Every Database has a **Local copy**: its encrypted `.kdbx` bytes in IndexedDB, keyed by Database id. For a Chrome file it duplicates the file; for a Firefox import it *is* the Database; for WebDAV it is the offline copy.
- **The Local copy is the source of truth; the Core's in-memory Database is its cache.** Every `Commit` (from `apply` or `merge`) is stored atomically before the result is reported. If storing fails, the background drops the Core handle and rebuilds it from the Local copy; the edit is lost and the user sees an error.
- A `cachedKey` that comes with a `Commit` replaces the one in `storage.session` only after the `Commit` is stored. If storing the `Commit` fails, the old `cachedKey` stays and the rebuild uses it ([`core-api.md`](core-api.md) § 9).
- **Pending changes** are counted by a `revision` in the Local copy store: it increments on every stored `Commit`, and Sync records `lastSyncedRevision`. Pending changes exist when `revision ≠ lastSyncedRevision`.
- `unlimitedStorage` is required so the Local copy is never evicted ([ADR-0013](../adr/0013-permissions-frozen-required-set.md)).

## The Source adapter

```ts
interface SourceAdapter {
  stat(): Promise<SourceResult<Version>>;
  read(): Promise<SourceResult<{ bytes: Uint8Array; version: Version }>>;
  write(bytes: Uint8Array, ifVersion: Version): Promise<SourceResult<Version>>;
  watch?(onChange: () => void): () => void;
}
```

Full contract in [`core-api.md`](core-api.md) §10. Adapters move bytes only. Merge-before-write lives above them in the TypeScript `Sync` module. MVP adapters: `chrome-local` and `webdav`. A Firefox import is not an adapter.

## Sync

The same loop for every live Source:

1. `stat()`. If the version equals the last synced version and there are no Pending changes, stop.
2. Note whether there were Pending changes **before** the Merge.
3. If the version differs: `read()`, then `CoreClient.merge(remoteBytes)`. Store the `commit` if there is one, then the `cachedKey` if there is one.
4. If there were no Pending changes before the Merge and `remoteNeedsWrite` is false, the Local copy now holds what the remote holds: record the remote version and set `lastSyncedRevision` to the current revision. Stop; nothing is written.
5. Otherwise `write(bytes, version)`. On `conflict`, start over from 1, at most 3 times, then fall back to the normal retry backoff.
6. On success, record the new version and `lastSyncedRevision`.

Step 4 matters: storing a Merge commit raises the revision, so without it every change made by another client would be written straight back to the Source, as a byte-different copy of the same content.

**Always merge, never fast-forward.** Whenever the remote differs from the last synced version, it is merged into the Local copy, even with no Pending changes, and the result is written back if it differs from the remote. This makes a server rollback harmless.

**Merge semantics** follow KeePassXC's `Merger`: match by UUID, the newer `LastModificationTime` wins, the loser goes to the Entry's History, `DeletedObjects` are honoured, and Meta is merged (custom icons, CustomData, Recycle Bin). Merge is silent; there is no conflict UI. The Core implements it; the keepass-rs fork must complete it (attachments, custom icons, Meta) and must not panic on differing root Groups.

**While Locked:** Sync works on encrypted bytes. If the remote has not changed, Pending changes are written. If it has, the download waits next to the Local copy as a remote snapshot, and the Merge runs after the next unlock.

**After unlock:** if a newer remote snapshot is on hand, it is merged in the background (one more KDF run, ~0.7 s, when the remote's KDF seed differs). The popup shows "Syncing…" and refreshes.

**The key changed on another device** (`RemoteKeyChanged`): pushing stops and the status says "Database password was changed on another device".

- Unlocked: the popup asks for the new key (ADR-0006). `merge(remote, { components })` uses the old key from `storage.session` and the new one, and the result is saved under the new key.
- Locked: the new key fails on the Local copy but opens the remote. Without Pending changes, the remote is adopted. With Pending changes, rimlock asks once for the old key so it can merge them, or offers an explicit, confirmed **Discard local changes**.
- After such a Merge, the key and the encryption settings come from the remote.

**Challenge-response Databases** are not supported in the MVP (`WrongKey`). The Core's `ChallengeResponseRequired` path exists for the Companion later, for KDBX 4.x only ([ADR-0011](../adr/0011-companion-is-a-capability-provider.md)). In KDBX 3.1 KeePassXC challenges the master seed and hashes the response in after the KDF, so challenge-response there stays unsupported after the Companion too ([#80](https://github.com/maxdubmors/rimlock/issues/80)).

## Chrome: local file (File System Access)

- **Pick:** `showOpenFilePicker()` in the add-a-Database tab. Adding always happens in a tab ([`databases-and-unlock.md`](databases-and-unlock.md)), so the picker never runs in the popup.
- **Write access:** the unlock gesture (the Unlock click or Enter) calls `requestPermission({mode: "readwrite"})` and passes the handle to the **offscreen document**. The offscreen document keeps the grant until the browser closes and holds only the handle, never the Database. The `FileSystemFileHandle` is stored in IndexedDB next to the Local copy, keyed by Database (it is structured-cloneable, not JSON, so it cannot live in `storage.local`). It survives a restart; access after a restart needs one gesture in the popup.
- **The offscreen document** is shared with clipboard clearing: one document, created on first need with reasons `[BLOBS, CLIPBOARD]`, never closed ([`manifest-and-permissions.md`](manifest-and-permissions.md)).
- **Fallback without a grant:** Pending changes wait for the next gesture in the popup, which shows "Changes not yet written to file".
- **"Allow on every visit"** (Chrome's restore prompt in a tab after a restart) is accepted when the user picks it, but rimlock does not steer anyone to it.
- **Unlock never depends on the file.** If the grant is refused, or the file was moved, deleted or is on an unmounted drive (`NotFoundError`), the Database unlocks from the Local copy and the popup shows "File not reachable — working from the local copy" with **Locate file…**, which opens a tab with a new picker, then merges the chosen file.
- **File changed while Locked:** at unlock the KDF runs on the **file** and the UI opens on it. If the Local copy also has Pending changes, a second KDF runs in the background, then Merge and write. If the file did not change, unlock uses the Local copy as usual.
- **Concurrent writers:** before every write, compare `lastModified` and `size` with the last known version; if they changed, read, merge, then write. External changes are noticed through `FileSystemObserver` (in the offscreen document), when the popup opens, and before every write. There is never an overwrite without a Merge. A save by another app that lands during our 0.2–0.7 s write can still be lost (Chrome's `.crswap` rename is last-writer-wins). The help pages say so; the UI does not warn.
- **Symlinks:** a freshly picked handle that fails its first read with `NotFoundError` gets "This file is a link; pick the target file instead".

## Firefox: imported copy

Firefox has no File System Access, so a local file is an imported copy.

- **Import** happens in an extension tab, because the popup closes when a picker opens. "Add local file" in the popup opens that tab. The Key file is picked there too.
- Edits go into the Local copy. The popup always shows a status line such as "Imported 3 Oct · 5 changes not exported".
- **Export…** saves the Local copy through `downloads.download({saveAs: true})` (the `downloads` permission is requested at the first Export…), defaulting to the original file name. It works while Locked.
- **Re-import…** opens a tab, takes a file, and merges it into the Local copy. Decrypting it needs an unlock in that tab.
- After a restart the Database unlocks from the Local copy; no re-import is needed. No notifications, no nagging.
- The UI says plainly that a local file in Firefox is an imported copy and that live sync needs WebDAV.

## WebDAV

**Connection and credentials**

- Basic auth over HTTPS only, with a hint to use an app password. No Digest.
- Requests use `credentials: "omit"` with rimlock's own `Authorization` header (this avoids Nextcloud's CSRF check) and `cache: "no-store"`.
- Credentials live in plain `storage.local` (pushing must work while Locked; they expose only ciphertext), with **Forget credentials**. Never in `storage.sync`.
- Host access: the server origin is covered by the required `http(s)://*/*`. **Connect** still calls `permissions.request({origins: [server]})` inside the click: no prompt when site access is granted, a prompt for that origin alone when it is withheld. Every Sync checks `permissions.contains`.
- WebDAV requests run only in the background (and extension pages), never in content scripts or in-page iframes. Chrome's Local Network Access does not affect them ([Chrome Local Network Access and extension fetches to private-IP WebDAV](https://github.com/maxdubmors/rimlock/issues/35)).
- Self-signed certificates are not supported in the MVP; they get the "Certificate not trusted" error with a help link. The Companion will cover them later.

**Version token and reads**

- The token for the last synced version is a strong ETag; otherwise `Last-Modified` + size. A weak ETag counts as absent.
- Reads are consistent with the token: take the ETag from the `GET` response, or `GET` with `If-Match` on the `PROPFIND` ETag.
- A freshly downloaded file that fails to decode is read once more before it counts as corrupt (another client may be mid-write).

**Writes: temp + `MOVE`**

1. `PUT` to a hidden sibling `.<name>.rimlock-<random>.tmp`.
2. Check it is there with the right size.
3. Re-check the destination ETag.
4. `MOVE` with `Overwrite: T` and a destination ETag condition. There is no server probe: the condition costs nothing where it is ignored and closes the race where it is enforced. A 412 is checked against a fresh stat; if the file did not change, the condition is dropped for this server and the `MOVE` repeated.
5. Servers without `MOVE` (405/501) fall back to a conditional direct `PUT`.
6. Temp files are deleted in `finally`. No server-side `.bak`.

**When to Sync**

- **Push** right after each commit, debounced ~1–2 s. On failure, retry through `alarms` with backoff 1 → 2 → 5 → 15 min (then every 15 min), plus on popup open and on the `online` event.
- **Pull check** (`PROPFIND`/`HEAD`) on popup open (also while Locked: the encrypted bytes are downloaded into the remote snapshot), before every push, and every 5 min through `alarms` while Unlocked. No periodic polling while Locked.

**Status and errors**

- A status line in the popup, always visible: `Synced · 2 min ago` / `Syncing…` / `Offline · 3 changes not synced` / `3 changes waiting — unlock to sync`.
- Errors that need action stop retries and show an action: 401/403 → **Update credentials…**; missing host permission → **Grant**; 404 → **Upload again** / **Change location…** (a new pick plus a Merge; never recreated silently).
- Transient errors (network, 5xx, 507, timeout) retry silently with backoff. The status keeps the last successful Sync time and the count of unsynced changes; details on click.
- The toolbar badge shows `!` only for errors that need action. No system notifications.

**Removing** a WebDAV Database with Pending changes asks first, as for every Source ([`databases-and-unlock.md`](databases-and-unlock.md) § Removing a Database).

## Room for more Sources

A new kind of Source is a new `SourceAdapter` plus a choice on the add screen; Sync, Merge, the Local copy and the status line stay as they are. An adapter qualifies when it has:

- a **strong version token** for `stat` (an ETag or equivalent), so changes are never missed;
- a **write that cannot leave a torn file** for other clients (atomic replace, or temp + rename), guarded by the version token, ideally with a server-enforced condition;
- **`https` only**, reached from the background, and covered by the required host permissions, because the required set never grows ([ADR-0013](../adr/0013-permissions-frozen-required-set.md)).

An **S3-compatible Source** (post-MVP) fits without changing any decision: `stat` = `HEAD` (ETag), `read` = `GET`, `write` = `PUT` with `If-Match` (an object `PUT` is atomic, so no temp + `MOVE`); SigV4 signing needs only WebCrypto's HMAC-SHA256; endpoints are `https` hosts already covered by `http(s)://*/*`, and background fetches with host access are not subject to CORS. One caveat: AWS S3 honours `If-Match` on `PutObject`, but not every S3-compatible store does, and S3 has no temp + `MOVE` to fall back on. A replaced object is never torn, but where the condition is not enforced the write is guarded only by a fresh ETag check, with the same residual race as a WebDAV server that ignores conditions (ADR-0008). So an S3 adapter must find out, per provider, whether the condition is enforced, ignored or rejected as unsupported, and handle each. Its access keys would live in `storage.local` under ADR-0002's reasoning, with help text recommending a key scoped to one bucket. Adding it means extending **Source** in the glossary.

Decision detail: [Decide local-file Source behaviour per browser](https://github.com/maxdubmors/rimlock/issues/13), [Decide WebDAV Source behaviour: offline cache, conflict detection, merge](https://github.com/maxdubmors/rimlock/issues/14), [Verify Chrome File System Access permission lifecycle in extension contexts](https://github.com/maxdubmors/rimlock/issues/16), [Define the Core API and the Source adapter contract](https://github.com/maxdubmors/rimlock/issues/26).
