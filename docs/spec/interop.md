# KeePass interop

The same `.kdbx` is edited by KeePassXC, KeePass 2.x, Strongbox, KeePassDX, Keepass2Android and KeePassium. The Core executes every rule below; TypeScript never reads raw fields, only `EntrySummary`/`MatchingInfo` and per-use secrets. Principle: [ADR-0010](../adr/0010-kdbx-interop-write-policies.md): change only what the user changed, in the form it already has; write new data where the most clients read it; add nothing of rimlock's own.

## File format

- Open KDBX 3.1, 4.0 and 4.1. Always write **KDBX 4.1**, silently (the help pages say so). Every current client reads 4.1 ([KDBX 4.1 support across KeePass clients](https://github.com/maxdubmors/rimlock/issues/20)).
- Never change the cipher, the KDF or its parameters, or compression. An AES-KDF file stays AES-KDF.
- rimlock's own saves reuse the KDF seed and draw a fresh master seed. A new KDF seed is drawn only when the Composite key or the KDF parameters change ([ADR-0005](../adr/0005-unlocked-state-rebuilt-on-every-wake-up.md)).
- **Never write non-standard XML.** KeePassium refuses files with any unknown element. If rimlock ever needs its own data, it goes into `rimlock.`-prefixed CustomData. In the MVP rimlock writes no data of its own.
- Unknown CustomData, passkeys, attachments, custom icons, tags, History and the Recycle Bin survive byte for byte.
- Required keepass-rs fork fixes: open Groups with unknown children (dropping them) and non-contiguous `<String>`; complete Merge; v2 Key file hash check; never write above 4.1, with a verified 3.1 → 4.1 round trip; open from a cached transformed key; save without re-running the KDF ([ADR-0003](../adr/0003-core-over-keepass-rs-fork.md)). The KDF itself runs in the Core ([`core-api.md`](core-api.md) § 3), where AES-KDF moves to WebCrypto.

## Untouched means byte-identical

- An edit rewrites only the values the user changed, under the keys, encodings and `Protected` flags they already have.
- Existing `Protected` flags are preserved. A new custom field is not Protected by default; the editor has a "hidden" toggle.
- Fill and Copy never touch the file: `LastAccessTime` and `UsageCount` are not updated.
- Foreign CustomData booleans are read case-insensitively and written in their owner's casing (`"true"` KeePassXC, `"True"` Strongbox).

## URLs

- **Read** as candidate URLs: `URL`, every `KP2A_URL*`, `URL_<n>` (KeePassDX), `URL-<anything>` (Strongbox importers), `URL <n>` (KeePassium's Bitwarden importer), and Kee's `KPRPC JSON` `altUrls`. A value counts only if it parses as an address. `OTPAuth` is not read.
- **Write:** a new additional URL (including "Also use this Entry on *site*") goes to `KP2A_URL`, `KP2A_URL_1`, … (the first free name). An edited URL keeps its key; keys are never renamed.
- Removing a `URL_n` from the middle shifts the later `URL_n` down so there is no gap (KeePassDX stops at the first gap). `KP2A_URL*` are not renumbered.
- The editor shows one URL list without keys.
- Kee: never write `KPRPC JSON`. If both v1 (string field) and v2 (CustomData) exist, v2 wins and v1 is left untouched. Kee `regExUrls` are ignored.

## TOTP

1. **Read order:** `otp` (otpauth URI or KeeOtp style), then `TimeOtp-*` (every secret encoding: UTF-8, Hex, Base32, Base64), then `TOTP Seed`/`TOTP Settings`, then an otpauth URL in Notes.
2. **Disagreement:** if the representations disagree, the Entry shows "two different TOTP secrets". **Use this one** rewrites all of them.
3. **Create:** `otp` (otpauth URI, Protected) plus `TimeOtp-Secret-Base32` (Protected), with `TimeOtp-Period`/`-Length`/`-Algorithm` only when not the default. Steam gets `otp` only. Canonical URI: `algorithm` exactly `SHA256` or `SHA512`, omitted for SHA-1. No `OTP` tag.
4. **Edit:** rewrite every representation already present, in its own encoding and style, and add the missing `otp` + `TimeOtp-Secret-Base32` pair.
5. **Remove:** remove every representation. From Notes, only Strongbox's labelled `Strongbox TOTP Auth URL: […]` block is cut.
6. `HmacOtp-*` is preserved, never used or shown.

## Browser settings and opt-outs

- The Entry editor has one toggle, **Don't offer in browser**, which writes `BrowserHideEntry="true"` and removes the key when switched off. It is the only browser setting rimlock writes.
- Autofill **reads** every hiding signal ([`autofill.md`](autofill.md)): `BrowserHideEntry`, KeePassXC Group tri-states, `KeePassXC-Browser Settings` `Deny`, Strongbox `KPEX_DoNotSuggestForAutoFill`, Kee `Hide`/`blockedUrls`, `BrowserOnlyHttpAuth`, and the Recycle Bin. Signals other than `BrowserHideEntry` are shown read-only with their source. `AutoType/Enabled=false` is **not** an opt-out.
- `KPXC_BROWSER_*` and `KeePassXC-Browser Settings` round-trip untouched.

## Tags

- Split on `,` and `;`.
- If the tag set is unchanged, the `Tags` text stays byte-identical.
- If it changed: new tags are appended, the existing order is kept, and the delimiter already used in that `Tags` is reused (`;` when there was none).
- A new tag may not contain `,`, `;` or `:`. Existing tags with `:` are kept.

## Field references and placeholders

- **Allow-list:** `{REF:W@S:…}` (W ∈ `TUPANI`, S ∈ `TUPANIO`), `{S:Name}`, `{TITLE}` `{USERNAME}` `{PASSWORD}` `{URL}` `{NOTES}` `{UUID}`, `{URL:RMVSCM|SCM|HOST|PORT|PATH|QUERY|USERINFO|USERNAME|PASSWORD}`, `{TIMEOTP}`/`{TOTP}`. Case-insensitive, recursion depth ≤ 10.
- Everything else (`{CMD}`, `cmd://`, `{HMACOTP}`, `{CLIPBOARD}`, `{PICKCHARS}`, `{NEWPASSWORD}`, `{T-CONV}`, `{T-REPLACE-RX}`, `{DT_*}`, `{GROUP*}`, …) stays literal text.
- `{REF}` search: exact match first (KeePassXC), then case-insensitive substring (KeePass).
- Resolved on Fill, Copy and display; the editor shows the raw text. In URLs used for Match, only `{REF}` is resolved.
- rimlock creates no references in the MVP.

## History, moves and deletes

- Every confirmed editor save and every Save-prompt Update puts the previous version into History, updates `LastModificationTime`, then trims History by `HistoryMaxItems`/`HistoryMaxSize` **on that Entry only**. History of untouched Entries is never trimmed.
- A move updates `LocationChanged`.
- Delete moves to the Recycle Bin and sets `PreviousParentGroup`. The bin is created lazily, KeePass-style (icon 43, searching and Auto-Type disabled).
- Deleting from the Recycle Bin, or with `RecycleBinEnabled=false`, is permanent, confirmed, and adds a `DeletedObject`.

## Proving it

Correctness depends on round trips no unit test can prove. The interop corpus holds files edited by rimlock and then opened and saved in the other clients ([`engineering.md`](engineering.md) § Tests).

Decision detail: [Decide KDBX interop write policies](https://github.com/maxdubmors/rimlock/issues/19). Conventions: [KeePass ecosystem conventions](https://github.com/maxdubmors/rimlock/issues/6), [KeePass conventions: Keepass2Android, KeePassium and Kee](https://github.com/maxdubmors/rimlock/issues/18). Library facts: [Evaluate KDBX core libraries](https://github.com/maxdubmors/rimlock/issues/2).
