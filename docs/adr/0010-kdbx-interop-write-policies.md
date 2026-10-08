# KDBX writes change only what the user changed, in the form that is already there, and add nothing of rimlock's own

The same `.kdbx` is edited by KeePassXC, KeePass 2.x, Strongbox, KeePassDX, Keepass2Android and KeePassium, and they disagree on where data lives: additional URLs, TOTP formats, tag delimiters. So the Core never re-encodes an Entry from its own model. An edit rewrites only the values the user changed, under the keys, encodings and `Protected` flags they already have. Anything the user did not touch stays byte-identical, including the `Tags` text when the tag set is unchanged. New data goes where the most clients read it: additional URLs go to `KP2A_URL`, `KP2A_URL_1`, … (first free name). A new TOTP goes to both `otp` (otpauth URI, canonical `algorithm=SHA256`/`SHA512`) and `TimeOtp-Secret-Base32`, so every client shows a code. A TOTP edit rewrites every representation already on the Entry. rimlock writes no data of its own into the Database. The only per-Entry browser setting it writes is KeePassXC's `BrowserHideEntry`, and Fills and copies never change the file (`LastAccessTime` and `UsageCount` are not updated).

## Considered Options

- **Re-encode each Entry from a rimlock model on save** (Keyguard's approach). Rejected: it renumbers additional URLs, re-sorts tags and trims history across the whole Database on every save. Each of these turns into a change that other clients sync and merge.
- **Write TOTP in one format.** Rejected: KeePass 2.x reads only `TimeOtp-*`, and KeePassXC reads only `otp` or `TimeOtp-Secret-Base32`. Clients also disagree on which format wins, so a copy left stale after a one-format edit shows a wrong code in some of them.
- **`URL_n` for additional URLs** (KeePassDX's autofill naming). Rejected: KeePassXC ignores it, whereas `KP2A_URL*` is written by KeePassXC, KeePassium and Keepass2Android and found by search in every client.
- **A `rimlock.*` namespace for browser settings.** Rejected: no other client would honour it. If rimlock ever needs its own data, it goes in `rimlock.`-prefixed CustomData, never in XML elements (KeePassium refuses files with unknown elements).
- **Warn when a KDBX 3.1/4.0 file is saved as 4.1.** Rejected: every current client reads 4.1, and KeePassDX and Keepass2Android may write the file back as 3.1. A warning would fire again on every round trip.

## Consequences

- When TOTP representations disagree, the read order is `otp`, then `TimeOtp-*`, then `TOTP Seed`/`TOTP Settings`, then an otpauth URL in Notes. The Entry shows a warning, and choosing one representation rewrites all of them. After an edit in KeePass 2.x, the wrong code is shown until the user picks the right one.
- Encryption settings (cipher, KDF and its parameters, compression) are never changed by a save. A file is always written as KDBX 4.1 (ADR-0003).
- History is trimmed only on the Entry being edited, never on Entries that rimlock did not touch.
- Correctness depends on round trips that no unit test can prove. The test corpus must include files edited by rimlock and then opened and saved in the other clients.
- Decision detail: [Decide KDBX interop write policies](https://github.com/maxdubmors/rimlock/issues/19). Conventions: [KeePass ecosystem conventions](https://github.com/maxdubmors/rimlock/issues/6), [KeePass conventions: Keepass2Android, KeePassium and Kee](https://github.com/maxdubmors/rimlock/issues/18).
