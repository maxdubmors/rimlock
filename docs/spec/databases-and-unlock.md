# Databases, unlock and Lock

Principles: [ADR-0005](../adr/0005-unlocked-state-rebuilt-on-every-wake-up.md) (rebuild on every wake-up), [ADR-0006](../adr/0006-composite-key-only-in-popup-or-tab.md) (Composite key only in the popup or a tab), [ADR-0012](../adr/0012-quick-unlock-never-weaker-than-auto-lock.md) (Quick unlock post-MVP), [ADR-0015](../adr/0015-several-databases-one-unlocked.md) (several Databases, one Unlocked). Core calls: [`core-api.md`](core-api.md) §3 and §11.

## Several Databases, one Unlocked

- The user can add several Databases. Each has its own Source, Local copy, Pending changes and per-Database Settings. **At most one is Unlocked.**
- Everything stored about a Database is keyed by its id: Local copy, Pending changes, `CachedKey`, remembered Key file, last Save-prompt Group, Draft.
- The popup header shows the current Database's name. A click opens the list of Databases, with "Add a Database" at the end. Switching **locks the current Database first**, with lock reason `switched`.
- The popup opens on the last unlocked Database.
- The Inline menu and the Save prompt work only with the Unlocked Database. Matches are never searched across Locked Databases. When every Database is Locked, they open the popup on the last unlocked Database, where the user can switch before unlocking.
- **Display name:** `Meta/DatabaseName`, else the file name. The second line shows the Source (file name or WebDAV host). rimlock does not rename Databases.

## First run

- `runtime.onInstalled` with `reason: "install"` (not `"update"`) opens a **welcome tab**.
- **Adding a Database always happens in a tab**, in both browsers and for both kinds of Source. An empty popup shows only "Add a Database", which opens that tab.
- The last first-run screen shows the site-access status, with **Allow on all sites** when access is withheld, and an optional **Turn off the browser's password saving** (requests `privacy` in that click). Both can be skipped. The clipboard permission waits for the first Copy.
- There is no "Create a new Database" in the MVP; the add screen links to KeePassXC.

## Adding a Database = the first unlock

1. Pick the Source:
   - **Chrome local file:** `showOpenFilePicker()` in this tab ([`sources.md`](sources.md)).
   - **Firefox local file:** import with `<input type=file>` ([`sources.md`](sources.md)).
   - **WebDAV:** server URL, login, password. The user pastes a file URL or a folder URL. For a folder, one `PROPFIND` lists its `.kdbx` files to pick from; there is no tree browsing. `http://` is refused ([`security.md`](security.md)).
2. Enter the Composite key: Master password and, optionally, a Key file, plus the "Remember Key file on this device" checkbox (off by default).
3. Unlock: `readHeader` → `unlock`. In Chrome, the same gesture also requests write access to the file.
4. **Only now** is the Database stored: its registry record, Source config and Local copy, taken from the verified bytes. A Database that never opened is never stored.

**Duplicates:** the same Source cannot be added twice (same WebDAV URL; the same Chrome file by `FileSystemHandle.isSameEntry`; Firefox imports are not checked). The same Database through a different Source is allowed.

**Errors, three kinds:**

| Kind | Message |
|---|---|
| Wrong key (`WrongKey`) | "Wrong Master password or Key file. If this Database uses a YubiKey, rimlock can't open it yet." The KDBX header has no hardware-key marker. |
| Unsupported or damaged file (`UnsupportedFile`, `Corrupt`) | The Core's reason text plus **Report this file**, which opens a GitHub issue template. No file data is attached and nothing is sent automatically. |
| Source unreachable (network, 401/403, missing permission, self-signed certificate) | Shown at the Source field. Self-signed: "Certificate not trusted" with a help link on trusting it in the OS or browser. There is no in-app exception. |

## Removing a Database

Settings → Databases → the Database → **Remove**. It deletes the Local copy, the `CachedKey`, the remembered Key file, the Source config (WebDAV credentials and the Chrome file handle included) and the Database's Settings.

With Pending changes, it asks first:

- **Sync first** (WebDAV and Chrome file only): runs Sync, then removes once nothing is pending;
- **Download a copy**: an `<a download>` of the Local copy (no `downloads` permission), then removes;
- **Remove anyway**, confirmed;
- **Cancel**.

Until M3 there is no write step in Sync, so **Sync first** is not offered before then ([`plan.md`](plan.md)). Removing a WebDAV Database does not call `permissions.remove`. There is no "change Source": remove the Database and add it again.

## Key file remembering

- Opt-in: "Remember Key file on this device", off by default, on the add screen and on the unlock screen.
- It stores the **processed Key-file component** (32 bytes), never the file or a handle, in `storage.local`. Same in both browsers.
- **Forget Key file** in the Database's Settings page, also while Locked.
- Without a remembered Key file, a Database that needs one shows **Unlock in a tab…** in the popup instead of a file field, because a file dialog closes the popup in Firefox and may do so in Chrome on Linux and macOS ([`verification.md`](verification.md) V7). The interrupted action resumes after the unlock.

## Unlock

- Happens only in the popup or an extension tab (ADR-0006). The popup unlock screen has room for a second method (Quick unlock later).
- **Unlock never depends on the Source**: it decrypts the Local copy and never waits for the network or the file. A newer remote found later is merged in the background ([`sources.md`](sources.md)).
- Flow: the popup sends the components → the background reads the Local copy → `readHeader` → `unlock` (the KDF, ~0.7 s, with a spinner) → the `CachedKey` goes to `storage.session` → the background broadcasts "unlocked".
- After an update-triggered lock, the unlock screen says "rimlock was updated, the Database was locked" (detected through `onInstalled` with `reason: "update"`).
- After an Auto-lock that discarded a Draft, the first screen after unlock says "Unsaved edits to *X* were discarded when the Database locked" ([`popup.md`](popup.md)).

## The Unlocked state and the wake-up rebuild

- **Only the background** (Chrome service worker, Firefox event page) holds the Core and the Unlocked Database. Popup, tab, options page, content scripts and the Inline menu iframe are clients over typed messages.
- `storage.session` holds, per Database: the opaque `CachedKey` (hashed Composite key plus the transformed-key cache tied to the KDF seed and parameters), lock metadata (last use, deadlines, lock reason), the Draft and pending saves. It is never the Master password or the Key file bytes. The access level of `storage.session` stays `TRUSTED_CONTEXTS`.
- On every wake-up: check the Auto-lock deadlines, then `open(localCopy, cachedKey)`. No KDF, no Source read. `CachedKeyStale` locks.
- `open` never reads the hashed Composite key in the `CachedKey` and never runs the KDF. The hashed Composite key is there for `merge`: it opens a remote that another client saved with a fresh KDF seed, without the Master password, at one KDF run ([`sources.md`](sources.md) § Sync). A `CachedKeyStale` on wake-up means the Local copy and `storage.session` are out of step, or the `CachedKey` format changed, so the background locks rather than guess why.
- **Acceptance criterion:** the rebuild (WASM instantiate + IndexedDB read + decrypt + XML parse) takes **≤ 200 ms** for the reference Database (~1000 Entries with History, ~1 MB) on a mid-range laptop in Chrome and Firefox. Measured in M0 ([`verification.md`](verification.md) V1).
- The `CoreClient` runs calls on the handle one at a time. A WASM panic marks the Core dead (`CoreUnavailable`), and the background rebuilds it from the Local copy.

## Lock

- **Manual:** the Lock button in the popup, and the `lock` command (unbound by default).
- **Lock procedure** (the same for every reason):
  1. record the lock reason: `manual`, `switched`, `idle-time` (T1), `os-lock` (T2), `system-idle` (T3), `last-window`, `update`, or `session-lost` (`storage.session` was wiped);
  2. delete the key material from `storage.session` and drop the Core instance (best-effort zeroize);
  3. broadcast "locked": popup, tab, Inline menu and Save prompt wipe any shown secrets and switch to their Locked state;
  4. a Draft is handled per [`popup.md`](popup.md) (manual Lock and switching ask; Auto-lock discards with a notice);
  5. pending saves are dropped;
  6. the clipboard is cleared at once if it still holds our value;
  7. an upload of encrypted bytes already in flight continues; a Merge that needs to decrypt the remote waits for the next unlock.
- **One restore point:** the only code that puts key material into `storage.session` is the one function that stores a `CachedKey` from a Core result. Quick unlock will reuse it (ADR-0012). A `CachedKey` that comes with a `Commit` is stored only after the `Commit` is in the Local copy; if that store fails, the old one stays ([`core-api.md`](core-api.md) § 9).

## Auto-lock

Global Settings, the same in both browsers:

| Trigger | Default | Notes |
|---|---|---|
| T1: time since last rimlock use (popup, search, Fill, editing, changing a setting) | **1 h** | 1 / 5 / 15 / 30 min, 1 / 4 / 8 h, "only on browser restart" |
| T2: OS screen lock (`idle` reports `"locked"`) | **on** | Chrome only; Firefox never reports `"locked"`. On Linux it depends on D-Bus ScreenSaver. |
| T3: system idle (`idle` reports `"idle"`) | **15 min** | Stands in for T2 in Firefox. Can be turned off. |
| Last normal browser window closed | always | `windows.onRemoved` + `windows.getAll({windowTypes: ['normal']})` |
| Browser restart | always | `storage.session` is wiped |
| Extension update | always | Chrome cannot defer it. Firefox: `runtime.onUpdateAvailable` → `runtime.reload()` at once if Locked, otherwise at the next Lock. |

- **The deadline is authoritative.** Every incoming message and every wake-up compares `Date.now()` with the stored deadlines and locks *before* serving the request. `alarms` only prompt that check (Chrome's minimum is 30 s). Neither browser has a sleep or resume event, and alarm timing after sleep is unreliable in Firefox on Linux.
- Set the `idle` detection interval at the top level on every background start.
- Never request the `background` permission: it keeps Chrome's profile, and `storage.session` with it, alive after the last window closes.
- Changing T1 recomputes the deadline as last use + new value, so shortening it below the time already idle locks at the next check.

Decision detail: [Decide where the unlocked Database lives and how locking works](https://github.com/maxdubmors/rimlock/issues/12), [Decide first run and adding a Database](https://github.com/maxdubmors/rimlock/issues/27), [Decide quick unlock](https://github.com/maxdubmors/rimlock/issues/22), [Stale CachedKey on wake-up: lock, or rebuild from the hashed Composite key (ADR-0005)?](https://github.com/maxdubmors/rimlock/issues/87).
