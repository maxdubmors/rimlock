# Security baseline

Every feature keeps these invariants. A change that weakens one needs an ADR first. Principle: [ADR-0002](../adr/0002-security-baseline.md), narrowed by [ADR-0006](../adr/0006-composite-key-only-in-popup-or-tab.md). Decision detail: [Define the threat model](https://github.com/maxdubmors/rimlock/issues/9).

## Goals

1. Confidentiality of Database contents (passwords, TOTP secrets, notes).
2. Confidentiality of the Composite key (Master password, Key file).
3. Integrity of the Database: no silent loss or corruption, including on Merge and round trips through other clients. Ranked equal to confidentiality.
4. An Entry's credentials reach only an origin that Matches it.

Offline availability is a reliability goal, not a security goal.

## Invariants

### Against a malicious web page (the primary adversary)

- The Master password and Key file are entered **only in the popup or an extension tab**. They are never entered in UI inside a page, not even an extension-origin iframe. When an unlock starts in a page, the in-page UI sends the user to the popup and the interrupted action resumes afterwards (ADR-0006).
- **Fill only on an explicit user action**: a click in the Inline menu, Fill in the popup, or the Fill shortcut. Nothing is filled on page load, so hidden fields and invisible forms are never filled.
- **Never auto-submit** a form.
- Candidates in a frame are Matched against **that frame's own URL**. In a frame from another site than the tab, the Inline menu never opens by itself ([`autofill.md`](autofill.md)).
- The Inline menu and the Save prompt are an extension-origin iframe in a closed shadow host in the top layer, with Proton's `TopLayerManager`-style clickjacking checks. Clickjacking remains a residual risk, as it does for every password manager.
- Secrets stay in page DOM no longer than the Fill itself.

### Against other extensions and compromised Matching origins

Out of reach: an extension with page access, an XSS on a Matching origin, a subdomain takeover. In scope:

- no `externally_connectable` and no external messaging API;
- messages from content scripts are untrusted; the background takes the tab, frame and origin from `sender`, never from the message payload;
- Match is no broader than KeePassXC's rules and is Public Suffix List-aware, so `a.github.io` never Matches `b.github.io`.

### At rest: nothing on disk stronger than the `.kdbx`

- The Local copy is the encrypted file. Key material derived from the Composite key is never persisted.
- Two accepted exceptions: remembering the Key file is opt-in (it protects against a compromised Source, not a compromised device), and WebDAV credentials are stored as low-sensitivity secrets (leaking them exposes only ciphertext).
- `storage.session` counts as browser-process memory. The `CachedKey`, the Draft and pending saves may live there.

### Unattended Unlocked device

A residual risk, bounded by Auto-lock ([`databases-and-unlock.md`](databases-and-unlock.md)). Quick unlock, when it comes, must never be weaker than Auto-lock ([ADR-0012](../adr/0012-quick-unlock-never-weaker-than-auto-lock.md)).

### Memory

Zeroization is hygiene, not a boundary. Decrypted data stays in WASM memory and is dropped on Lock. JavaScript strings carry only the single field being shown, filled or copied.

### Network and the WebDAV server

- HTTPS only. `http://` is refused everywhere, including LAN and `localhost`, and rimlock checks the scheme itself because Firefox silently upgrades it ([Decide first run and adding a Database](https://github.com/maxdubmors/rimlock/issues/27) replaced the earlier `localhost` exception).
- Tampering is caught by the KDBX 4 header and block HMACs. Rollback, deletion and substitution cannot be detected, but Merge never loses local changes because of a server rollback ([ADR-0008](../adr/0008-webdav-source-always-merge.md)).
- A save never weakens the Database's KDF or cipher.

### Leaks

- **Zero telemetry**, no remote crash reports, no runtime fetches other than the user's own WebDAV server. No favicons are fetched and no remote rules or models are downloaded.
- **Logs never contain secrets, by type**: a `Secret` prints and serialises as `[Secret]`; only the messaging codec may encode it. Rust secret types implement neither `Debug` nor `Display` with their content.
- Copied values are cleared from the clipboard ([`generator-and-copy.md`](generator-and-copy.md)).

### Database content is untrusted input

No HTML rendering of Entry content. Only `http`/`https` URLs, plus a small explicit allow-list, are opened. Field sizes are limited. An XSS in the extension origin would be a full compromise, so Svelte's `{@html}` is never used on Database content.

### Supply chain

- Minimal dependencies, especially in content scripts. A new runtime module in the `content` bundle needs an explicit owner decision.
- Lockfiles, exact pins and a reproducible build ([`engineering.md`](engineering.md)).
- CSP without `unsafe-eval`; only `'wasm-unsafe-eval'`.
- No automated system can publish a release ([ADR-0018](../adr/0018-releases-built-by-ci-uploaded-by-hand.md)).

## Out of reach

Host malware, a compromised browser or OS (keyloggers, memory dumps, swap, crash dumps), other extensions with page access, and a compromised Matching origin. The help pages say so plainly.
