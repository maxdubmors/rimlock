# Local-file Source: an offscreen document holds the file handle in Chrome; Firefox imports and exports by hand

In Chrome, the Extension gets write access to a local `.kdbx` in the same user gesture that unlocks it and hands the `FileSystemFileHandle` to an offscreen document. That document keeps the grant alive until the browser closes, so the background can write Pending changes even when no extension page is open. It also watches the file with `FileSystemObserver`. A grant lives only while some context holds a handle, the service worker loses its handles on idle teardown and can never request one, so something other than the worker has to hold the handle. ADR-0005 rejects the offscreen document as the home of the Unlocked Database. Here it holds only a handle to encrypted bytes, and losing it costs nothing: Pending changes then wait for the next gesture in the popup.

Firefox has no File System Access, so there a local file is an imported copy. The user imports it in a tab, edits the Local copy freely, and writes the file back on demand with **Export…** (a Save As dialog). **Re-import…** merges the file into the Local copy. The popup always shows how many changes have not been exported yet.

## Considered Options

- **Chrome: "Allow on every visit" as the main path.** It gives headless access across restarts, but Chrome offers it only in a tab and only after a restart, so it cannot be part of first run. rimlock accepts it when the user picks it but does not steer them to it. It reveals nothing, because only ciphertext is overwritten.
- **Chrome: write only while an extension page is open.** Rejected as the main path: saves from the Save prompt would wait for the next popup, and every popup would need a click to get the grant back. Kept as the fallback.
- **Firefox: silent overwrite inside Downloads/ via `downloads.download()`.** Rejected: it works only for a Database that lives directly in Downloads/, it adds noise to the download history, and its reliability is unverified.
- **Firefox: Save As on every commit.** Rejected: every edit commits immediately (ADR-0005), so the dialog would appear on every edit.
- **Firefox: no local file without the Companion.** Rejected: an imported copy with merge on re-import is still useful, and WebDAV covers live sync.

## Consequences

- Unlock never depends on the file. If the grant is refused or the file is gone, the Extension unlocks from the Local copy and offers "Locate file…".
- Before every write the Extension compares `lastModified` and `size`. If the file changed, it merges first, which waits for an unlock if the Database is Locked. A write that races another app's save within the same fraction of a second can still lose that save. The help pages document this; the UI does not warn.
- The offscreen document needs a reason that Chrome Web Store review accepts. No reason covers holding a file handle, so it is created with `[BLOBS, CLIPBOARD]` and shared with clipboard clearing (ADR-0013).
- Decision detail: [Decide local-file Source behaviour per browser](https://github.com/maxdubmors/rimlock/issues/13).
