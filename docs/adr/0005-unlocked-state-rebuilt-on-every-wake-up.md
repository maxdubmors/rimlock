# The Unlocked Database is rebuilt on every background wake-up from a local encrypted copy and the Composite key held in storage.session

The background is the only context that holds the Core and an Unlocked Database. It dies after ~30 s idle in every MV3 browser, so it keeps nothing it cannot rebuild. Every edit is committed at once: the Core re-encrypts the Database, and the result atomically replaces a local encrypted copy kept in IndexedDB for every Source. On wake-up the background rebuilds the Database from that copy and from key material in `storage.session`, without running the KDF and without touching the Source. The key material is the hashed Composite key (the KDF input, never the Master password or Key file bytes), plus a cache of the transformed key tied to the KDF seed and parameters. The hashed Composite key is needed because every major KeePass client writes a fresh KDF seed on each save, so a transformed key alone goes stale after any other client saves the file. Without the hashed Composite key, every save from another client over WebDAV would force the Master password again. rimlock's own saves reuse the KDF seed and draw a fresh master seed. A new KDF seed is drawn only when the Composite key or the KDF parameters change. The KDF therefore runs only at unlock and when another client has saved the file.

## Considered Options

- **Long-lived offscreen document as the holder (Chrome).** Rejected: it goes against Chrome's stated intent, a future lifetime enforcer could close it, and it does not exist in Firefox.
- **MV2 persistent background on Firefox.** Rejected: rebuilding on wake-up works the same in an event page, so ADR-0004's fallback is not needed.
- **Re-running the KDF on every wake-up.** Rejected: 0.7–3 s in single-threaded WASM every time the popup opens after a pause.
- **Only the transformed key in `storage.session`.** Rejected: narrower, but it breaks concurrent use with other clients, which is non-negotiable.
- **A Core instance per extension page.** Rejected: several writers, and more than one place to lock.
- **Multithreaded Argon2.** Not needed: the KDF no longer sits on the wake-up path.

## Consequences

- The keepass-rs fork must, in the MVP, be able to open from a cached transformed key and to save without re-running the KDF.
- Source sync works on encrypted bytes only, so it is independent of Locked/Unlocked. A merge that needs to decrypt the remote waits for the next unlock.
- Acceptance criterion: rebuilding on wake-up takes ≤ 200 ms for a reference Database (~1000 Entries with history, ~1 MB) on a mid-range laptop in Chrome and Firefox. Measure it in the first WASM smoke test.
- Auto-lock is enforced by a deadline check on every message and wake-up, and `alarms` only prompt that check. Firefox never reports an OS screen lock, so system idle stands in for it there.
- Decision detail: [Decide where the unlocked Database lives and how locking works](https://github.com/maxdubmors/rimlock/issues/12).
