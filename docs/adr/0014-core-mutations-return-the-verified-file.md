# Every Core mutation returns the verified encrypted file, and the Core keeps no state that a teardown would lose

The Core has one mutating entry point, `apply(changes[])`. It applies the changes to a clone of the Database, serialises and encrypts the clone, decrypts and parses those bytes again to check them, and only then swaps its state and returns the whole encrypted `.kdbx` as a `Commit`. TypeScript stores the `Commit` atomically as the Local copy. The Local copy is the source of truth and the in-memory Database is only its cache: if storing fails, the background drops the Core instance and rebuilds it from the Local copy. ADR-0005 already requires every edit to commit at once and the background to survive a teardown at any moment, so a mutation that leaves the file unwritten would be a bug waiting for an agent to forget a call. The same rule makes multi-step key flows stateless. Two-phase unlock is `readHeader` then `unlock(components)`, and a merge that needs a hardware-key response fails with `ChallengeResponseRequired { challenge }` and is simply called again with the response. Nothing waits in Core memory while the user touches a YubiKey or types a new key.

## Considered Options

- **Mutations change memory, an explicit `save()` writes the file.** Rejected: every caller must remember `save()`, and an edit held only in memory dies with the worker.
- **One method per operation, each returning a `Commit`.** Rejected: moving or deleting several Entries would encrypt the file once per Entry, and an editor save would produce several history versions instead of one.
- **Commit without verifying.** Rejected: a serialisation bug would silently replace the Local copy and then spread to every client through Sync. Verifying costs one decrypt and parse, within the ≤ 200 ms rebuild budget of ADR-0005.
- **A `PendingUnlock` object between the two unlock phases.** Rejected: it would not survive a worker teardown during a slow hardware-key touch.

## Consequences

- A `Commit` carries the full file (~1 MB for the reference Database) across the seam on every edit. This is accepted: an edit has to write that much to IndexedDB anyway.
- Pending changes are counted by a revision in the TS Local copy store, not by the Core.
- Contract: [`docs/spec/core-api.md`](../spec/core-api.md). Decision detail: [Define the Core API and the Source adapter contract](https://github.com/maxdubmors/rimlock/issues/26).
