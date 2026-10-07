# Chrome File System Access permission lifecycle in extension contexts

Ticket: [Verify Chrome File System Access permission lifecycle in extension contexts](https://github.com/maxdubmors/rimlock/issues/16). It checks by experiment the inferences in [Source access from extensions: local files and WebDAV](https://github.com/maxdubmors/rimlock/issues/4) (`research/source-access`, §1 and Open risks 1–3).

**Setup.** Chrome for Testing 155.0.8059.39 (stable channel) on Linux (niri, Chrome on XWayland), KeePassXC 2.7.12 (`keepassxc-cli`), 2026-10-07. The throwaway extension and its CDP drivers are in [`prototypes/fsa-permission-lifecycle/`](../../prototypes/fsa-permission-lifecycle/). Step ids below (E1.5, I3, …) refer to its [`results/`](../../prototypes/fsa-permission-lifecycle/results/).

**Method.**
- Handles come from an OS drag-and-drop (`DataTransferItem.getAsFileSystemHandle()`), because CDP can intercept `showOpenFilePicker()` but cannot answer it.
- User gestures are real CDP mouse clicks.
- "No gesture" means a raw `Runtime.evaluate` with `userGesture: false`, run after transient activation has expired.
- A restart is a browser quit and relaunch on the same profile.
- Service-worker teardown is modelled by dropping the worker's handles and forcing GC. A real 30-second idle stop cannot be observed while DevTools is attached.

## Answers

| Question | Inferred in #4 | Observed |
|---|---|---|
| Is a restored handle auto-granted in the popup? | Yes, via the "no request manager" branch | **Yes, with a gesture.** After a restart, `queryPermission` is `prompt` everywhere (E1.1, E1.3). In the popup, `requestPermission({mode: "readwrite"})` inside a click returns `granted` within ~10 ms and shows no UI (E1.5). Without a gesture it throws `SecurityError` (E1.4). |
| Do grants made outside a tab live until a restart? | Yes, until restart or until an extension tab closes | **No.** An active grant lives only while some `FileSystemHandle` for that path is alive in some context of the extension. Closing the popup drops the grant if nothing else holds a handle (E1.7). The same happens when the worker's handles are collected (E2.5), when the offscreen document closes (E3.5) and when a tab closes (E5.4). |
| Does the service worker or offscreen document see a grant made in the popup? | Yes | **Yes, while the grant is alive.** Grants are per origin and path, so every context shares them (E1.6, E2.3, E3.3). Neither context can create one: in the worker, `requestPermission` returns `prompt` (E1.9), and the offscreen document never has user activation (`SecurityError`, E3.6). |
| How do `.crswap` and replace-on-close interact with KeePassXC and sync clients? | Swap file, then a move over the target | Same pattern as KeePassXC's own save (temp file + rename). The handle survives a replace by KeePassXC. A save that lands while a writable is open is **silently lost**. Details below. |

Side panel: not tested. rimlock has none ([Sketch the Extension UI shape](https://github.com/maxdubmors/rimlock/issues/10)), and the source sends it down the same no-request-manager branch as the popup.

## Findings

### 1. A grant lives as long as its handles

In Chromium, active grants are reference-counted `PermissionGrantImpl` objects, created with `base::MakeRefCounted` and held by the browser-side handle objects. `ChromeFileSystemAccessPermissionContext::PermissionGrantDestroyed()` erases a grant from the origin's active map as soon as its last reference goes [1]. A handle created afterwards (from IndexedDB, say) gets a fresh grant in state `ASK`. The experiments match this exactly:

- **Popup only (E1).** Granted in the popup, the worker sees `granted` while the popup is open (E1.6). Once the popup closes, the worker sees `prompt` and `getFile()` fails with `NotAllowedError` (E1.7, E1.8).
- **The worker as holder (E2).** The grant outlives the popup while the worker keeps a handle in a global (E2.3, E2.4). Once that handle is released and collected, the grant is gone (E2.5). A real teardown destroys the worker's whole heap after ~30 s idle (see [MV3 background execution and unlocked-state lifetime](https://github.com/maxdubmors/rimlock/issues/3)), so **the worker cannot keep a grant alive across idle teardowns.**
- **The offscreen document as holder (E3).** An offscreen document that holds a handle keeps the grant alive after the popup closes and the worker's handles are collected. The worker can then write (E3.3, E3.4). Closing the document drops the grant (E3.5). An offscreen document (reason `WORKERS`) lives independently of the worker until it is closed. A browser restart or an extension update ends it.
- **A tab as holder (E5).** A tab works the same way (E5.3, E5.4).

The 16-hour "all tabs in background" expiry only affects persisted grants, and the last-tab-closed cleanup ([4]'s `OnLastPageFromOriginClosed`) exists too, but handle lifetime is what decides this in practice.

GC caveat: a handle that has become unreachable but not yet collected also keeps the grant alive. That is why a sloppy test sees grants "sometimes survive" (the first, discarded run of this probe did). Code must not rely on it.

### 2. Gestures and contexts

- **Popup.** `requestPermission` with a gesture is auto-granted without UI, on a restored handle and on a new one (E1.5, E2.1). The code path is the one in [1] (`RequestPermission`). It checks user activation first, so a popup cannot get a grant silently (E1.4).
- **Extension tab.** It has a request manager, so it shows a real prompt (E4.2, request left pending). There are two prompt kinds:
  - **Restore prompt.** Shown after a restart if the origin held grants last session and no tab of the origin has closed since: "*\<extension\> wants to view and edit files from the last time you visited this site* · Allow this time / **Allow on every visit** / Don't allow" ([screenshot](../../prototypes/fsa-permission-lifecycle/screenshots/tab-restore-prompt.png)). The popup's auto-grant records the grant as persisted (`kUpdatePersistedPermission`), and that record is what the restore prompt offers back.
  - **Plain prompt** ("Allow this site to edit *x*? · Don't Allow / Allow"). Shown otherwise, for example after a tab of the origin closed, because `CleanupPermissions` revokes the dormant persisted grants [1].
- **Service worker and offscreen document.** They can use a live grant but can never create one.

### 3. "Allow on every visit" makes access fully headless

Choosing "Allow on every visit" in the tab sets `FILE_SYSTEM_ACCESS_EXTENDED_PERMISSION` for `chrome-extension://<id>` (`OnRestorePermissionAllowedEveryTime` [1]). From then on:
- the grant survives when every handle is gone (A.2);
- after a browser restart, with no extension page open, the worker reads, writes and gets `granted` from `queryPermission` and `requestPermission` with no gesture and no UI (B.1–B.5);
- the popup starts out `granted` too (B.6);
- a file the user adopts later still needs one grant: an auto-grant in the popup, or a prompt in a tab (interop setup).

This contradicts #4's reading that extended grants are effectively unavailable to `chrome-extension://`. They are available, but only through a tab, and only when the restore prompt appears. The popup never offers the option because it never prompts. The user can revoke it in Chrome's site settings. Not verified: whether it survives an extension update. It is keyed by origin and the extension ID is stable, so it should.

### 4. Writes on disk

| Case | Observed |
|---|---|
| A write through `createWritable()` (I1) | inotify: `CREATE x.crswap`, `MODIFY`, `CLOSE_WRITE`, `MOVED_FROM x.crswap`, `MOVED_TO x`, `ATTRIB x`. The inode changes and the original mode is kept (`0640` → `0640`). `keepassxc-cli` opens the result. A full rewrite of a 1.6 KB file took 480–730 ms the first time in a session and 170–230 ms afterwards (Chrome's after-write checks). |
| KeePassXC saves while the extension holds the handle (I2) | KeePassXC writes `x.XXXXXX` and renames it over `x`: the same pattern as Chrome. The handle resolves by path, so `getFile()` returns the new file (I2.3). A `File` obtained before the save throws `NotReadableError` (I2.2). |
| KeePassXC saves while the extension's writable is open (I3) | The `.crswap` is visible next to the file. KeePassXC's save succeeds (entry `external-2` is present). Then `close()` renames the swap over it and **`external-2` is gone**. Last writer wins, with no error on either side. |
| The context dies with a writable open (I4) | The offscreen document closed mid-write: `.crswap` is deleted and the target is untouched. |
| The handle points at a symlink (I5, X1–X3) | `queryPermission` says `granted`, but `getFile()` and `createWritable()` throw `NotFoundError`, and nothing on disk changes. Tested only for a dropped symlink. What the picker returns for a symlink was not tested. |

**KeePassXC watching the file.** Not run against the GUI: the owner's own KeePassXC instance was running, and KeePassXC is single-instance. From source (2.7.12 `FileWatcher`, `Database::open`/`save`) [2]: KeePassXC watches the canonical path with `QFileSystemWatcher` (polling on NFS) and every 30 s compares a SHA-256 of the first 1 KiB. Chrome's rename-over is indistinguishable from KeePassXC's own save or from Syncthing's. A real KDBX save rewrites the header (new seeds and IVs), so the checksum changes and KeePassXC reloads the file, or offers a merge if it has unsaved changes.

**Sync clients.** From docs, not run:
- **Syncthing** batches watcher events for 10 s [3]. A `.crswap` that lives for well under a second is gone before the scan, so only the replaced file syncs.
- **Nextcloud desktop**'s default exclude list has `*.crdownload` and `*.part` but **not `*.crswap`** [4]. A `.crswap` therefore syncs only if a sync run catches it inside the write window.
- **Dropbox:** not examined.

The exposure is the time between `createWritable()` and `close()`, so a writer should pass the whole buffer in one `write()` and close at once.

## What this changes for Decide local-file Source behaviour per browser

These are facts for that decision to weigh, not decisions:

1. **Background push needs a grant holder.** Under ADR-0005 the background pushes the local copy to the Source asynchronously, possibly while Locked. In Chrome a popup grant is gone the moment the popup closes unless something holds a handle. There are three ways to keep write access:
   - a long-lived **offscreen document** that holds the handle: one gesture per browser session;
   - the user grants **"Allow on every visit"** once, in a tab, from the restore prompt: headless across restarts;
   - write **only while an extension page is open**.
2. **"Allow on every visit" needs a tab and a restart.** The restore prompt appears only in a tab, after a restart, and only if no tab of the origin closed in between. Getting the user there is a deliberate UX flow, not a side effect. Its security cost is that the Extension can overwrite the encrypted `.kdbx` with no user present. It reveals nothing.
3. **Concurrent writers.** No lock exists, and a KeePassXC save during an open writable is silently overwritten. A Source writer has to:
   - check `lastModified` and `size` (or a hash) immediately before `createWritable()`;
   - write the whole buffer and close at once;
   - check again on the next read and merge.

   A window of a few hundred milliseconds stays.
4. **Re-read every time.** Always call `getFile()` again, never keep a `File`. A replace by any other app (KeePassXC, a sync client) makes an old `File` unreadable but leaves the handle valid.
5. **Symlinked databases** are unsupported at least via drag-and-drop. The UI should say so rather than fail with `NotFoundError`.

## Gaps

- The real `showOpenFilePicker()` was not exercised (CDP cannot answer it). That the popup survives the native picker still rests on the M143 fix cited in #4. Checking it takes one manual click in the probe's popup ("pick + request").
- The service-worker idle stop was modelled by GC, not observed.
- Linux only. Rename and replace semantics, and KeePassXC's and sync clients' reactions, were not tested on Windows or macOS.
- An extension update with "Allow on every visit" set was not verified.

## Sources

- [1] Chromium `chrome/browser/file_system_access/chrome_file_system_access_permission_context.cc` (main, 2026-10-07): `PermissionGrantImpl::RequestPermission` (extension auto-grant branch, user-activation check, `kUpdatePersistedPermission`), `PermissionGrantDestroyed`, `CleanupPermissions`, `OnAllTabsInBackgroundTimerExpired` (16 h, persisted grants only), `OnRestorePermissionAllowedEveryTime` — https://source.chromium.org/chromium/chromium/src/+/main:chrome/browser/file_system_access/chrome_file_system_access_permission_context.cc ; `chrome/browser/permissions/one_time_permissions_tracker.cc` — https://source.chromium.org/chromium/chromium/src/+/main:chrome/browser/permissions/one_time_permissions_tracker.cc
- [2] KeePassXC 2.7.12 `src/core/FileWatcher.cpp`, `src/core/Database.cpp` (`m_fileWatcher->start(path, 30, 1)`) — https://github.com/keepassxreboot/keepassxc/blob/2.7.12/src/core/FileWatcher.cpp
- [3] Syncthing docs, "Understanding Synchronization" (`fsWatcherDelayS` = 10 s, temporary files) — https://docs.syncthing.net/users/syncing.html
- [4] Nextcloud desktop `sync-exclude.lst` (master) — https://github.com/nextcloud/desktop/blob/master/sync-exclude.lst
- Chrome DevTools Protocol: `Page.fileChooserOpened` (`backendNodeId` only for `<input type=file>`), `Input.dispatchDragEvent` (`DragData.files`) — from Chrome 155's `/json/protocol`.
