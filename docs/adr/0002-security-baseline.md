# Security baseline: nothing on disk stronger than the .kdbx, storage.session is trusted memory, no telemetry

The Extension writes nothing to disk that is weaker than the `.kdbx` itself: the WebDAV offline cache is the encrypted file, and key material derived from the Composite key is never persisted. Two deliberate exceptions are recorded as residual risk. Remembering the Key file is opt-in, because the Key file defends against a compromised Source, not a compromised device. WebDAV credentials are stored as low-sensitivity secrets, because leaking them exposes only ciphertext. `storage.session` counts as browser-process memory, so Unlocked-state key material may live there. Otherwise every MV3 worker wake-up would need the Master password again, and anyone who can read browser memory is already out of reach (host malware). The Extension sends no telemetry and no remote crash reports.

## Considered Options

- Treat `storage.session` as untrusted and keep only wrapped data in it. Rejected: there is nowhere to keep the wrapping key, so this collapses into re-entering the Master password on every worker wake-up.
- Never remember the Key file. Rejected as the only mode: on Firefox the Extension cannot remember a path, so the Key file would have to be re-selected after every browser restart.

## Consequences

The full threat model is in [Define the threat model](https://github.com/maxdubmors/rimlock/issues/9). Unlocked state, autofill and Source tickets must satisfy it.
