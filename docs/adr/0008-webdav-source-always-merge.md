# WebDAV Source: always merge, conditional writes without probing, temp + MOVE

Whenever the WebDAV file differs from the version last synced, the Extension merges it with the Local copy and writes the result back if it differs from the remote. It never adopts the remote version as is, even with no Pending changes. That makes a server rollback harmless: the merge puts our newer Entries back. Merge follows KeePassXC's `Merger` (match by UUID, newer `LastModificationTime` wins, the loser goes to history, `DeletedObjects` honoured, Meta merged), so every client sharing the file reaches the same result. Every write is guarded twice: a fresh ETag check right before the swap, and an `If-Match`-style condition that only some servers enforce. The Extension does not probe which servers do. Writes go to a hidden temporary sibling, are checked for size, then replace the file with `MOVE`, so an interrupted upload can never leave a torn `.kdbx` for other clients. WebDAV credentials are kept in plain `storage.local`, because pushing must work while Locked and the credentials expose only ciphertext (ADR-0002).

## Considered Options

- **Fast-forward to the remote when there are no Pending changes.** Rejected: it silently accepts a server rollback. Always merging costs one extra KDF run (~0.7 s, in the background).
- **Three-way merge against a stored base.** Rejected: more precise and immune to clock skew, but it would produce different results from KeePassXC on the same two files.
- **Probe the server once for `If-Match` support.** Rejected: it leaves a scratch file in the user's folder and changes nothing. The condition costs nothing where it is ignored and closes the race where it is enforced.
- **Direct PUT.** Rejected as the main path: on servers without atomic PUT (rclone, possibly Synology and Yandex Disk) a dropped connection truncates the file for every other client. Kept as the fallback when a server does not support `MOVE`.
- **Credentials encrypted under a key derived from the Composite key.** Rejected: it would stop pushing while Locked, against ADR-0005.

## Consequences

- On servers that ignore conditions, a save by another client that lands between our final check and the swap can still be lost. The help pages say so; the UI does not warn (same as ADR-0007).
- The keepass-rs merge must be completed in the fork: attachments, custom icons and Meta are missing today.
- If the remote no longer opens with the hashed Composite key (the Master password or Key file changed elsewhere), pushing stops until the user enters the new key. After that merge, the key and the encryption settings are taken from the remote.
- Decision detail: [Decide WebDAV Source behaviour: offline cache, conflict detection, merge](https://github.com/maxdubmors/rimlock/issues/14).
