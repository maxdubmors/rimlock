# KeePass ecosystem conventions

Research for [#6](https://github.com/maxdubmors/rimlock/issues/6). Date: 2026-10-06.

## Question

Which on-disk conventions must the Extension read and write so that a Database stays interoperable with KeePassXC, KeePassXC-Browser, Strongbox, KeePassDX and KeePass 2.x? The ticket covers:

- URL matching: the `URL` field, additional URLs (`KP2A_URL*`), and the KeePassXC-Browser settings stored in Entry/Group CustomData (hide entry, skip auto-submit, HTTP-auth only, allowed/denied sites).
- TOTP storage formats: `otp` (otpauth URI), `TimeOtp-*` (KeePass 2.47+), and legacy `TOTP Seed` / `TOTP Settings`. Which clients read and write each one.
- Recycle bin, history retention, tags, icons, expiry, `Notes` conventions, and passkey attributes (`KPEX_PASSKEY_*`), at least so they are preserved.
- Field references (`{REF:...}`) and the placeholders that autofill should resolve.

## Sources

All claims below cite code at a pinned revision:

| Project | Revision | Link prefix used below |
|---|---|---|
| KeePassXC | `9e0f57a4` (develop, 2026-09-22) | [KXC](https://github.com/keepassxreboot/keepassxc/tree/9e0f57a4a4c6c629fa6d0a593acb7d089b1d95cd) |
| KeePassXC-Browser | `8b0b2c43` (1.10.4.1, 2026-10-02) | [KXB](https://github.com/keepassxreboot/keepassxc-browser/tree/8b0b2c4347126f4983f59ea7dd6ca2a2a667cf48) |
| KeePassDX | `2db52c5f` (2026-09-25) | [KDX](https://github.com/Kunzisoft/KeePassDX/tree/2db52c5fd016aad50352ba60383f6aefd29100c4) |
| Strongbox | `c70fc7b0` (2026-07-17) | [SBX](https://github.com/strongbox-password-safe/Strongbox/tree/c70fc7b021d9dfa2b18a6d7e13406e717dd5251a) |
| KeePass 2.x | 2.61 source ([KeePass-2.61-Source.zip](https://sourceforge.net/projects/keepass/files/KeePass%202.x/2.61/KeePass-2.61-Source.zip)). This was the newest source on SourceForge; 2.62 returned 404. KeePass has no public VCS, so citations are `zip:path:line`. | KP2 |
| KeePassRPC (Kee) | `dc0a59b6` | [KRPC](https://github.com/kee-org/keepassrpc/tree/dc0a59b60b3ac21da9944bc5b98fe96e706af80a) |
| KDBX 4.1 spec | keepass.info, [archived 2026-06-29](https://web.archive.org/web/20260629035532/https://keepass.info/help/kb/kdbx_4.1.html). keepass.info itself sits behind a bot check. | — |

KeePass 2.x help pages are cited from the copy in the source zip (`Docs/Chm/help/base/*.html`), which matches keepass.info/help.

## Summary

| Convention | Storage location / format | Reads | Writes |
|---|---|---|---|
| Primary URL | String field `URL` | all | all |
| Additional URLs (KeePassXC / KP2A style) | String fields `KP2A_URL`, `KP2A_URL_1`, `KP2A_URL_2`, … (any key starting with `KP2A_URL`) | KeePassXC (prefix match), Strongbox (prefix `KP2A_URL` or `URL`), KeePassDX (any field whose name contains `_URL`, search only) | KeePassXC (UI), KeePassXC importers |
| Additional URLs (KeePassDX style) | String fields `URL_1`, `URL_2`, … (contiguous) | KeePassDX, Strongbox (prefix `URL`) | KeePassDX (autofill save) |
| Android app IDs | `AndroidApp`, `AndroidApp_1`…, plus `AndroidApp Signature[_n]` | KeePassDX | KeePassDX |
| Browser per-entry site ACL | Entry CustomData `KeePassXC-Browser Settings` = JSON `{"Allow":[hosts],"Deny":[hosts],"Realm":"…"}` | KeePassXC | KeePassXC |
| Browser per-entry flags | Entry CustomData `BrowserHideEntry`, `BrowserSkipAutoSubmit`, `BrowserOnlyHttpAuth`, `BrowserNotHttpAuth` = `"true"`/`"false"` | KeePassXC | KeePassXC |
| Browser per-group flags (inherited) | Group CustomData: the same four keys plus `BrowserOmitWww` and `BrowserRestrictKey` (string). Key absent means inherit. | KeePassXC | KeePassXC |
| Browser association keys | Meta CustomData `KPXC_BROWSER_<id>` = public key | KeePassXC | KeePassXC |
| Strongbox autofill exclusion | Entry CustomData `KPEX_DoNotSuggestForAutoFill` = `"True"` | Strongbox | Strongbox |
| Kee (KeePassRPC) entry config | `KPRPC JSON` as an entry string (v1) or entry CustomData (v2) | KeePassRPC | KeePassRPC |
| TOTP, otpauth URI | String `otp` = `otpauth://totp/…?secret=…&period=…&digits=…[&algorithm=…][&encoder=steam]` (also KeeOtp `key=…&size=…&step=…`) | KeePassXC, KeePassDX, Strongbox. **Not KeePass 2.x.** | KeePassXC (default), KeePassDX, Strongbox (default on) |
| TOTP, KeePass 2.x native | `TimeOtp-Secret` / `-Hex` / `-Base32` / `-Base64`, `TimeOtp-Length`, `TimeOtp-Period`, `TimeOtp-Algorithm` (`HMAC-SHA-1/256/512`) | KeePass 2.47+, KeePassDX (all), Strongbox (all), KeePassXC (**only `-Base32`**) | KeePass 2.x, Strongbox (always, alongside `otp`) |
| HOTP, KeePass 2.x native | `HmacOtp-Secret[-Hex/-Base32/-Base64]`, `HmacOtp-Counter` | KeePass 2.x, KeePassDX | KeePass 2.x (increments counter on use) |
| TOTP, legacy KeePassXC | `TOTP Seed` (base32) + `TOTP Settings` (`step;digits` or `step;S` for Steam) | KeePassXC (highest priority), KeePassDX, Strongbox | KeePassXC (only for legacy-format entries), Strongbox (opt-in, off by default) |
| TOTP in Notes | `otpauth://` URL anywhere in Notes; Strongbox's own `Strongbox TOTP Auth URL: […]` block | Strongbox | Strongbox (option) |
| Passkey | String fields `KPEX_PASSKEY_USERNAME`, `_CREDENTIAL_ID` (base64url, protected), `_PRIVATE_KEY_PEM` (PKCS#8 PEM, protected), `_RELYING_PARTY`, `_USER_HANDLE` (base64url, protected), `_FLAG_BE`, `_FLAG_BS` (`"1"`); `_PRF` (KeePassDX). Legacy aliases `KPEX_PASSKEY_GENERATED_USER_ID`, `KPXC_PASSKEY_USERNAME` (Strongbox). Tag `Passkey`. | KeePassXC, KeePassDX, Strongbox | KeePassXC, KeePassDX, Strongbox |
| Recycle bin | Meta `RecycleBinEnabled`, `RecycleBinUUID`, `RecycleBinChanged`; group named "Recycle Bin", icon 43, `EnableSearching=false`, `EnableAutoType=false`; entry/group `PreviousParentGroup` (4.1) | all | all |
| Permanent deletion | `DeletedObjects/DeletedObject{UUID,DeletionTime}` | all (merge/sync) | all |
| History retention | Meta `HistoryMaxItems` (default 10, −1 = unlimited), `HistoryMaxSize` (default 6 MiB, −1 = unlimited), `MaintenanceHistoryDays` (365) | all | all |
| Tags | `Tags` element on Entry, and on Group from KDBX 4.1. Separated by `;` (KeePass 2.x, Strongbox) or `,` (KeePassXC, KeePassDX). | all. Delimiters on read: KeePass `,;`; KeePassXC `,;\t`; KeePassDX `,;`; Strongbox `;:,` | all |
| Built-in icon | `IconID` 0–68 (`PwIcon`; 43 = TrashBin) | all | all |
| Custom icon | Meta `CustomIcons/Icon{UUID,Data(PNG),Name,LastModificationTime}` (Name/LMT are 4.1); entry/group `CustomIconUUID` | all | all |
| Expiry | `Times/Expires` (bool) + `Times/ExpiryTime` | all; KeePassXC-Browser denies expired entries unless a setting allows them | all |
| Password-quality opt-out | Entry `QualityCheck=false` (4.1); legacy CustomData `KnownBad="true"` | KeePass 2.48+, KeePassXC | KeePass 2.48+, KeePassXC |
| KeePassDX templates | Meta `EntryTemplatesGroup` + template entries with `_etm_template`, `_etm_template_uuid`, `_etm_position_*`, `_etm_title_*`, `_etm_type_*` | KeePassDX (KeePass 2 KPEntryTemplates-compatible) | KeePassDX |
| KeePassXC public header data | KDBX 4 outer-header `PublicCustomData`: `KPXC_PUBLIC_UUID`, `KPXC_PUBLIC_NAME`, `KPXC_PUBLIC_COLOR`, `KPXC_PUBLIC_ICON` | KeePassXC | KeePassXC |
| Field references | `{REF:<W>@<S>:<text>}`, with W ∈ `T U P A N I` and S ∈ `T U P A N I O`; UUID as 32 uppercase hex | KeePass 2.x, KeePassXC, KeePassDX, Strongbox | KeePass 2.x, KeePassXC (always `@I:`) |
| Placeholders | `{TITLE}` `{USERNAME}` `{PASSWORD}` `{URL}` `{NOTES}` `{S:Name}` `{URL:…}` `{UUID}` `{TIMEOTP}`/`{TOTP}` … (case-insensitive) | KeePass 2.x (full set), KeePassXC (subset), Strongbox (subset), KeePassDX (`{REF}`/`{S:}`) | n/a (user-entered) |

## Findings

### 1. URL matching

#### 1.1 Primary and additional URLs

- KeePassXC uses `KP2A_URL` (named after Keepass2Android) as the prefix for additional URLs ([KXC `src/core/EntryAttributes.cpp#L43`](https://github.com/keepassxreboot/keepassxc/blob/9e0f57a4a4c6c629fa6d0a593acb7d089b1d95cd/src/core/EntryAttributes.cpp#L43)).
  - **Read:** any attribute whose key *starts with* `KP2A_URL`. The value of `KPEX_PASSKEY_RELYING_PARTY` also counts as an additional URL. Placeholders in additional URLs are resolved ([`src/core/Entry.cpp#L402-L430`](https://github.com/keepassxreboot/keepassxc/blob/9e0f57a4a4c6c629fa6d0a593acb7d089b1d95cd/src/core/Entry.cpp#L402-L430)).
  - **Write:** the first new URL is named `KP2A_URL`, the next ones `KP2A_URL_1`, `KP2A_URL_2`, and so on, taking the first free name ([`src/gui/entry/EditEntryWidget.cpp#L451-L470`](https://github.com/keepassxreboot/keepassxc/blob/9e0f57a4a4c6c629fa6d0a593acb7d089b1d95cd/src/gui/entry/EditEntryWidget.cpp#L451-L470)). The Bitwarden, Proton Pass, 1PUX and OpVault importers write `KP2A_URL_<i>` (e.g. [`src/format/BitwardenReader.cpp#L131`](https://github.com/keepassxreboot/keepassxc/blob/9e0f57a4a4c6c629fa6d0a593acb7d089b1d95cd/src/format/BitwardenReader.cpp#L131)).
  - The primary `URL` is placeholder-resolved only when it contains a `{REF:…}` ([`src/core/Entry.cpp#L390-L400`](https://github.com/keepassxreboot/keepassxc/blob/9e0f57a4a4c6c629fa6d0a593acb7d089b1d95cd/src/core/Entry.cpp#L390-L400)).
- KeePassDX uses a different scheme.
  - **Write:** extra web origins go to `URL_1`, `URL_2`, …. The suffix is `"_$position"` ([KDX `model/AppOriginEntryField.kt#L29-L31`, `#L89-L111`](https://github.com/Kunzisoft/KeePassDX/blob/2db52c5fd016aad50352ba60383f6aefd29100c4/database/src/main/java/com/kunzisoft/keepass/model/AppOriginEntryField.kt#L29-L111); [`model/EntryInfo.kt#L416-L418`](https://github.com/Kunzisoft/KeePassDX/blob/2db52c5fd016aad50352ba60383f6aefd29100c4/database/src/main/java/com/kunzisoft/keepass/model/EntryInfo.kt#L416-L418)).
  - **Read:** origins come from consecutive `URL_n` fields only; reading stops at the first gap ([`AppOriginEntryField.kt#L36-L78`](https://github.com/Kunzisoft/KeePassDX/blob/2db52c5fd016aad50352ba60383f6aefd29100c4/database/src/main/java/com/kunzisoft/keepass/model/AppOriginEntryField.kt#L36-L78)).
  - **Search:** a field counts as a web domain when its name starts with `URL`, contains `_URL` or contains `URL_`. `KP2A_URL*` fields therefore match in search ([`#L163-L172`](https://github.com/Kunzisoft/KeePassDX/blob/2db52c5fd016aad50352ba60383f6aefd29100c4/database/src/main/java/com/kunzisoft/keepass/model/AppOriginEntryField.kt#L163-L172), [`database/search/SearchHelper.kt#L199-L211`](https://github.com/Kunzisoft/KeePassDX/blob/2db52c5fd016aad50352ba60383f6aefd29100c4/database/src/main/java/com/kunzisoft/keepass/database/search/SearchHelper.kt#L199-L211)).
  - **Android apps:** app package names are stored in `AndroidApp[_n]`, with optional `AndroidApp Signature[_n]`.
- Strongbox treats any custom field whose key starts with `KP2A_URL` or `URL` as an alternative URL ([SBX `model/NodeFields.m#L56-L58`](https://github.com/strongbox-password-safe/Strongbox/blob/c70fc7b021d9dfa2b18a6d7e13406e717dd5251a/model/NodeFields.m#L56-L58)).
- KeePass 2.x core has no browser matching and no additional-URL convention. Its URL field is used for opening URLs and supports `cmd://` and URL overrides ([KP2 `Docs/Chm/help/base/autourl.html`]).
- **Implication for rimlock:**
  - When reading, treat `URL`, every `KP2A_URL*` key, and every `URL_<n>` key as candidate URLs.
  - When writing, create new additional URLs as `KP2A_URL`, `KP2A_URL_1`, …. KeePassXC, Strongbox and KeePassDX search all find these names. Never rename existing keys.

#### 1.2 KeePassXC matching semantics (the de facto reference)

These rules come from [KXC `src/browser/BrowserService.cpp`](https://github.com/keepassxreboot/keepassxc/blob/9e0f57a4a4c6c629fa6d0a593acb7d089b1d95cd/src/browser/BrowserService.cpp):

- **Candidate search** ([L1012-L1063](https://github.com/keepassxreboot/keepassxc/blob/9e0f57a4a4c6c629fa6d0a593acb7d089b1d95cd/src/browser/BrowserService.cpp#L1012-L1063)):
  - Skips recycled groups and entries.
  - Skips groups whose resolved `BrowserHideEntry` is enabled, and entries with `BrowserHideEntry="true"` when the group setting is "inherit".
  - Skips groups whose resolved `BrowserRestrictKey` is set but does not match the connected browser key.
  - Applies `BrowserOmitWww`.
  - If nothing matches, it retries with the first subdomain label removed ([L1112](https://github.com/keepassxreboot/keepassxc/blob/9e0f57a4a4c6c629fa6d0a593acb7d089b1d95cd/src/browser/BrowserService.cpp#L1112)).
- **Special URLs** ([L1366-L1393](https://github.com/keepassxreboot/keepassxc/blob/9e0f57a4a4c6c629fa6d0a593acb7d089b1d95cd/src/browser/BrowserService.cpp#L1366-L1393)): `keepassxc://by-uuid/<hex>` and `keepassxc://by-path/<path>` are special request URLs. Wildcards apply only to *additional* URLs.
- **URL comparison** (`handleURL`, [L1470-L1557](https://github.com/keepassxreboot/keepassxc/blob/9e0f57a4a4c6c629fa6d0a593acb7d089b1d95cd/src/browser/BrowserService.cpp#L1470-L1557)):
  - A URL wrapped in `"…"` must equal the site URL exactly.
  - `*` is a wildcard.
  - A URL without a scheme is parsed as user input; when "match URL scheme" is on, the scheme is forced to `https`.
  - If the entry URL has a port, the port must match.
  - `file://` URLs are compared directly.
  - The registrable base domain must match, and the site host must end with the entry host.
- **Ranking** (`sortPriority`, [L1277-L1343](https://github.com/keepassxreboot/keepassxc/blob/9e0f57a4a4c6c629fa6d0a593acb7d089b1d95cd/src/browser/BrowserService.cpp#L1277-L1343)): exact match 100, exact without query 90, parent path 85, same host 80 (form host 70), subdomain suffix 60/50. A "best match only" setting keeps only the top tier.
- **KeePassDX comparison:** its search compares with `inTheSameDomainAs`, with an optional same-subdomain requirement ([KDX `utils/UriHelper.kt#L70-L91`](https://github.com/Kunzisoft/KeePassDX/blob/2db52c5fd016aad50352ba60383f6aefd29100c4/database/src/main/java/com/kunzisoft/keepass/utils/UriHelper.kt#L70-L91)). It excludes the recycle bin and template groups ([`SearchHelper.kt#L126`](https://github.com/Kunzisoft/KeePassDX/blob/2db52c5fd016aad50352ba60383f6aefd29100c4/database/src/main/java/com/kunzisoft/keepass/database/search/SearchHelper.kt#L126)) and, by default, expired entries ([`#L175`](https://github.com/Kunzisoft/KeePassDX/blob/2db52c5fd016aad50352ba60383f6aefd29100c4/database/src/main/java/com/kunzisoft/keepass/database/search/SearchHelper.kt#L175)).

#### 1.3 KeePassXC-Browser settings in CustomData

- KeePassXC-Browser itself never touches the `.kdbx` file. KeePassXC writes these keys on its behalf; the extension only receives derived JSON such as `skipAutoSubmit`, `expired`, `totp` and `stringFields` ([KXB `keepassxc-browser/content/fill.js#L156-L158`](https://github.com/keepassxreboot/keepassxc-browser/blob/8b0b2c4347126f4983f59ea7dd6ca2a2a667cf48/keepassxc-browser/content/fill.js#L156-L158), [`keepassxc-protocol.md`](https://github.com/keepassxreboot/keepassxc-browser/blob/8b0b2c4347126f4983f59ea7dd6ca2a2a667cf48/keepassxc-protocol.md)).
- **Key names:** `KeePassXC-Browser Settings`, `BrowserSkipAutoSubmit`, `BrowserHideEntry`, `BrowserOnlyHttpAuth`, `BrowserNotHttpAuth`, `BrowserOmitWww`, `BrowserRestrictKey`. Default groups are "KeePassXC-Browser Passwords" and "KeePassXC-Browser Passkeys" ([KXC `BrowserService.cpp#L55-L70`](https://github.com/keepassxreboot/keepassxc/blob/9e0f57a4a4c6c629fa6d0a593acb7d089b1d95cd/src/browser/BrowserService.cpp#L55-L70)).
- **Allow/deny ACL:** compact JSON with the Qt property names `Allow` (string list of hosts), `Deny` and `Realm` ([`src/browser/BrowserEntryConfig.h#L31-L33`](https://github.com/keepassxreboot/keepassxc/blob/9e0f57a4a4c6c629fa6d0a593acb7d089b1d95cd/src/browser/BrowserEntryConfig.h#L31-L33), [`BrowserEntryConfig.cpp#L84-L111`](https://github.com/keepassxreboot/keepassxc/blob/9e0f57a4a4c6c629fa6d0a593acb7d089b1d95cd/src/browser/BrowserEntryConfig.cpp#L84-L111)).
  - `allowEntry` adds the site host, and the form host if it differs. `denyEntry` is the mirror image ([`BrowserService.cpp#L1151-L1186`](https://github.com/keepassxreboot/keepassxc/blob/9e0f57a4a4c6c629fa6d0a593acb7d089b1d95cd/src/browser/BrowserService.cpp#L1151-L1186)).
  - `checkAccess` returns, in order: Denied if the entry is expired (unless allowed by a setting); Allowed if the hosts are in `Allow`; Denied if they are in `Deny` or the realm mismatches; otherwise Unknown, which means "ask the user" ([`#L1227-L1246`](https://github.com/keepassxreboot/keepassxc/blob/9e0f57a4a4c6c629fa6d0a593acb7d089b1d95cd/src/browser/BrowserService.cpp#L1227-L1246)).
- **Boolean values** are the literal strings `"true"` / `"false"` ([`src/core/Global.h#L47-L48`](https://github.com/keepassxreboot/keepassxc/blob/9e0f57a4a4c6c629fa6d0a593acb7d089b1d95cd/src/core/Global.h#L47-L48)). Group values are tri-state: key missing means inherit from the parent, `"true"` means enable, anything else means disable ([`src/core/Group.cpp#L268-L310`](https://github.com/keepassxreboot/keepassxc/blob/9e0f57a4a4c6c629fa6d0a593acb7d089b1d95cd/src/core/Group.cpp#L268-L310)).
- **Option behaviour:**
  - `BrowserSkipAutoSubmit`: the group value overrides the entry value; when the group inherits, the entry value is used ([`BrowserService.cpp#L1188-L1225`](https://github.com/keepassxreboot/keepassxc/blob/9e0f57a4a4c6c629fa6d0a593acb7d089b1d95cd/src/browser/BrowserService.cpp#L1188-L1225)).
  - `BrowserOnlyHttpAuth` / `BrowserNotHttpAuth`: enabled if either the entry or the resolved group setting is enabled ([`#L384-L400`](https://github.com/keepassxreboot/keepassxc/blob/9e0f57a4a4c6c629fa6d0a593acb7d089b1d95cd/src/browser/BrowserService.cpp#L384-L400)).
- **`KPH:` fields:** when the "KPH fields" setting is on, string fields whose names start with `KPH: ` are returned as extra fill values. `KPH: {TOTP}` is recognised ([`#L1213-L1223`](https://github.com/keepassxreboot/keepassxc/blob/9e0f57a4a4c6c629fa6d0a593acb7d089b1d95cd/src/browser/BrowserService.cpp#L1213-L1223); [KXB `content/keepassxc-browser.js#L144`](https://github.com/keepassxreboot/keepassxc-browser/blob/8b0b2c4347126f4983f59ea7dd6ca2a2a667cf48/keepassxc-browser/content/keepassxc-browser.js#L144)).
- **Other KeePassXC CustomData keys:** Meta `KPXC_BROWSER_<id>`, `_LAST_MODIFIED`, `KPXC_RANDOM_SLUG`, `KPXC_REMOTE_SYNC_SETTINGS`, `FDO_SECRETS_EXPOSED_GROUP`, `KPXC_DECRYPTION_TIME_PREFERENCE`, and the legacy `KnownBad` ([`src/core/CustomData.cpp#L23-L29`](https://github.com/keepassxreboot/keepassxc/blob/9e0f57a4a4c6c629fa6d0a593acb7d089b1d95cd/src/core/CustomData.cpp#L23-L29)).
- **Equivalent keys in other clients:**
  - Strongbox uses entry CustomData `KPEX_DoNotSuggestForAutoFill` with value `"True"`, capital T ([SBX `StrongBox/Constants.m#L64`](https://github.com/strongbox-password-safe/Strongbox/blob/c70fc7b021d9dfa2b18a6d7e13406e717dd5251a/StrongBox/Constants.m#L64), [`model/NodeFields.m#L1250-L1263`](https://github.com/strongbox-password-safe/Strongbox/blob/c70fc7b021d9dfa2b18a6d7e13406e717dd5251a/model/NodeFields.m#L1250-L1263), [`model/keepass/KeePassConstants.h#L64`](https://github.com/strongbox-password-safe/Strongbox/blob/c70fc7b021d9dfa2b18a6d7e13406e717dd5251a/model/keepass/KeePassConstants.h#L64)). Strongbox does not read `BrowserHideEntry`.
  - Kee / KeePassRPC stores per-entry matching config as `KPRPC JSON`: v1 in an entry string, v2 in entry CustomData ([KRPC `KeePassRPC/Extensions.cs#L24-L66`](https://github.com/kee-org/keepassrpc/blob/dc0a59b60b3ac21da9944bc5b98fe96e706af80a/KeePassRPC/Extensions.cs#L24-L66)).
- **Format constraint:** Entry and Group CustomData do not exist in KDBX 3.1. KeePassXC bumps the file to KDBX 4 as soon as any entry or group carries CustomData, or the outer header has `PublicCustomData` ([`src/format/KeePass2Writer.cpp#L52-L108`](https://github.com/keepassxreboot/keepassxc/blob/9e0f57a4a4c6c629fa6d0a593acb7d089b1d95cd/src/format/KeePass2Writer.cpp#L52-L108)).

### 2. TOTP storage formats

| Format | Defined by | KeePassXC | KeePassDX | Strongbox | KeePass 2.x |
|---|---|---|---|---|---|
| `otp` = `otpauth://…` | Google Key URI | read (priority 2), **write default** | read (priority 1), **write** | read (priority 2), write (pref `addOtpAuthUrl`, default YES) | no native reading; import button only |
| `otp` = `key=…&size=…&step=…[&otpHashMode=…]` (KeeOtp) | KeeOtp plugin | read + write back in the same format | read | read + write (if the entry was already in that style) | plugin only |
| `TimeOtp-Secret[-Hex/-Base32/-Base64]`, `-Length`, `-Period`, `-Algorithm` | KeePass 2.47 | read **only `-Base32`** (priority 3); never writes or removes | read all (priority 2) | read all; **always writes `-Base32`** (+ non-default Period/Length/Algorithm) | read + write; `{TIMEOTP}` |
| `HmacOtp-*`, `HmacOtp-Counter` | KeePass 2.47 | no | read | no | read + write (counter++ on use) |
| `TOTP Seed` + `TOTP Settings` | old KeePassXC | read (priority 1); writes only when the entry is already in this format | read | read; writes when `addLegacySupplementaryTotpCustomFields` is on (default NO) | no |

Details and citations:

- **KeePassXC**
  - Constants are in [KXC `src/core/Totp.h#L70-L78`](https://github.com/keepassxreboot/keepassxc/blob/9e0f57a4a4c6c629fa6d0a593acb7d089b1d95cd/src/core/Totp.h#L70-L78).
  - Read priority is `TOTP Settings`(+`TOTP Seed`), then `otp`, then `TimeOtp-Secret-Base32` with Algorithm/Length/Period ([`src/core/Entry.cpp#L631-L647`](https://github.com/keepassxreboot/keepassxc/blob/9e0f57a4a4c6c629fa6d0a593acb7d089b1d95cd/src/core/Entry.cpp#L631-L647)).
  - `setTotp` removes `otp`, `TOTP Seed` and `TOTP Settings` but **leaves `TimeOtp-*` untouched**. It writes `otp` (protected), or the legacy pair for LEGACY-format entries ([`#L609-L629`](https://github.com/keepassxreboot/keepassxc/blob/9e0f57a4a4c6c629fa6d0a593acb7d089b1d95cd/src/core/Entry.cpp#L609-L629)).
  - Parsing ([`src/core/Totp.cpp#L85-L162`](https://github.com/keepassxreboot/keepassxc/blob/9e0f57a4a4c6c629fa6d0a593acb7d089b1d95cd/src/core/Totp.cpp#L85-L162)):
    - otpauth query keys: `secret`, `digits`, `period`, `encoder`, `algorithm`. `algorithm` accepts `SHA1/256/512` and `HMAC-SHA-*`.
    - Digits are clamped to 1–10 and the step to 1–86400.
    - Steam is `encoder=steam` (5 characters from the alphabet `23456789BCDFGHJKMNPQRTVWXY`).
  - Write template ([`#L169-L203`](https://github.com/keepassxreboot/keepassxc/blob/9e0f57a4a4c6c629fa6d0a593acb7d089b1d95cd/src/core/Totp.cpp#L169-L203)): `otpauth://totp/<title>:<user>?secret=<b32>&period=<n>&digits=<n>&issuer=<title>`, plus `&encoder=steam` and `&algorithm=` when not the default.
- **KeePass 2.x**
  - Field names: `Secret`, `Secret-Hex`, `Secret-Base32`, `Secret-Base64` under the prefixes `TimeOtp-` and `HmacOtp-`, plus `TimeOtp-Length` (default 6), `TimeOtp-Period` and `TimeOtp-Algorithm`. The secret precedence is UTF-8 → Hex → Base32 → Base64 (KP2 `KeePass/Util/EntryUtil.cs:404-441`).
  - Algorithm values are `HMAC-SHA-1`, `HMAC-SHA-256`, `HMAC-SHA-512` (KP2 `KeePassLib/Cryptography/HmacOtp.cs:40-42`).
  - `{HMACOTP}` increments `HmacOtp-Counter` and marks the database modified (KP2 `EntryUtil.cs:456-482`).
  - otpauth URIs are only *imported*, converting them to `TimeOtp-*` (KP2 `EntryUtil.cs:514+`). No `"otp"` field is read anywhere in the 2.61 source.
- **KeePassDX**
  - Read order is `otp` URI, then KeePass 2.47 `TimeOtp-*`, then KeeOtp key/values, then `TOTP Seed`/`TOTP Settings`, then KeePass 2 `HmacOtp-*` ([KDX `otp/OtpEntryFields.kt#L105-L123`](https://github.com/Kunzisoft/KeePassDX/blob/2db52c5fd016aad50352ba60383f6aefd29100c4/database/src/main/java/com/kunzisoft/keepass/otp/OtpEntryFields.kt#L105-L123)).
  - Writes `otp` (protected) only, and adds the tag `OTP` ([`#L434-L466`](https://github.com/Kunzisoft/KeePassDX/blob/2db52c5fd016aad50352ba60383f6aefd29100c4/database/src/main/java/com/kunzisoft/keepass/otp/OtpEntryFields.kt#L434-L466)).
- **Strongbox**
  - Read order is the Password field as an otpauth URL, then the `otp` field (otpauth or KeeOtp), then `TimeOtp-*`, then `TOTP Seed`/`TOTP Settings`, then an otpauth URL in Notes, then a KeeOtp last-resort fallback ([SBX `model/NodeFields.m#L850-L897`](https://github.com/strongbox-password-safe/Strongbox/blob/c70fc7b021d9dfa2b18a6d7e13406e717dd5251a/model/NodeFields.m#L850-L897)).
  - On write it always writes `TimeOtp-Secret-Base32`, except for Steam/Yandex. It also writes `otp` when `addOtpAuthUrl` is on, and the legacy fields when that option is on ([`#L708-L790`](https://github.com/strongbox-password-safe/Strongbox/blob/c70fc7b021d9dfa2b18a6d7e13406e717dd5251a/model/NodeFields.m#L708-L790)).
  - `clearTotp` removes every format, including the Notes block ([`#L792-L828`](https://github.com/strongbox-password-safe/Strongbox/blob/c70fc7b021d9dfa2b18a6d7e13406e717dd5251a/model/NodeFields.m#L792-L828)).
  - Defaults: `addOtpAuthUrl` = YES and legacy = NO ([`macbox/MacBox/Settings.m#L966-L976`](https://github.com/strongbox-password-safe/Strongbox/blob/c70fc7b021d9dfa2b18a6d7e13406e717dd5251a/macbox/MacBox/Settings.m#L966-L976)).
- **Implication for rimlock:**
  - **Read** all five formats.
  - **When creating TOTP**, write both `otp` (otpauth URI, protected) and `TimeOtp-Secret-Base32` (+ Period/Length/Algorithm when not the default). This is the Strongbox pattern, and it gives a working code in all four apps.
  - **When editing TOTP**, rewrite *every* representation already present on the Entry. KeePassXC edits leave stale `TimeOtp-*` behind, and clients disagree on precedence: KeePassXC prefers the legacy pair first, KeePassDX and Strongbox prefer `otp` first.
  - Steam TOTP has no `TimeOtp-*` form, so use `otp` only.

### 3. Recycle bin, history, tags, icons, expiry, Notes, passkeys

#### Recycle bin

- **KeePass 2.x behaviour:**
  - It creates the bin lazily as a root child named "Recycle Bin", with icon `TrashBin` (43), `EnableAutoType=false` and `EnableSearching=false`, and sets Meta `RecycleBinUUID` (KP2 `KeePass/Forms/MainForm_Functions.cs:5060-5085`).
  - Deleting an item that is *already* in the bin, deleting while the bin is disabled, or Shift+Delete removes it permanently and adds a `DeletedObject{UUID, DeletionTime}`.
  - Otherwise the item moves to the bin, `PreviousParentGroup` is set, and `Touch` updates `LocationChanged` (KP2 `MainForm_Functions.cs:5180-5205`).
- **KeePassXC** does the same ([KXC `src/core/Database.cpp#L1018-L1053`](https://github.com/keepassxreboot/keepassxc/blob/9e0f57a4a4c6c629fa6d0a593acb7d089b1d95cd/src/core/Database.cpp#L1018-L1053), icon 43 at [`src/core/Group.cpp#L31`](https://github.com/keepassxreboot/keepassxc/blob/9e0f57a4a4c6c629fa6d0a593acb7d089b1d95cd/src/core/Group.cpp#L31)):
  - It records `DeletedObject`s when an Entry or Group is destroyed ([`src/core/Entry.cpp#L76`](https://github.com/keepassxreboot/keepassxc/blob/9e0f57a4a4c6c629fa6d0a593acb7d089b1d95cd/src/core/Entry.cpp#L76), [`src/core/Group.cpp#L52-L68`](https://github.com/keepassxreboot/keepassxc/blob/9e0f57a4a4c6c629fa6d0a593acb7d089b1d95cd/src/core/Group.cpp#L52-L68)).
  - It sets `PreviousParentGroup` and `LocationChanged` on move ([`src/core/Entry.cpp#L1405-L1440`](https://github.com/keepassxreboot/keepassxc/blob/9e0f57a4a4c6c629fa6d0a593acb7d089b1d95cd/src/core/Entry.cpp#L1407-L1437)).
  - Browser search skips recycled items.
- **Spec note:** `PreviousParentGroup` is a KDBX 4.1 element, but KeePass 2.x does not upgrade the file to 4.1 for it alone (KDBX 4.1 spec, "Migration Phase"). KeePassXC only writes it when the file is ≥ 4.1 ([`src/format/KdbxXmlWriter.cpp#L406-L413`](https://github.com/keepassxreboot/keepassxc/blob/9e0f57a4a4c6c629fa6d0a593acb7d089b1d95cd/src/format/KdbxXmlWriter.cpp#L406-L413)).

#### History

- **Settings:** Meta `HistoryMaxItems` (default 10, −1 = unlimited), `HistoryMaxSize` (default 6 MiB, −1 = unlimited) and `MaintenanceHistoryDays` (365) (KP2 `KeePassLib/PwDatabase.cs:47-48,72,93-94`; KXC [`src/core/Metadata.cpp#L27-L57`](https://github.com/keepassxreboot/keepassxc/blob/9e0f57a4a4c6c629fa6d0a593acb7d089b1d95cd/src/core/Metadata.cpp#L27-L57)).
- **Trimming:** after an edit, both clients trim the oldest history items until the item and size limits hold (KP2 `KeePassLib/PwEntry.cs:646-687` `MaintainBackups`; KXC [`Entry::truncateHistory` `src/core/Entry.cpp#L886-L936`](https://github.com/keepassxreboot/keepassxc/blob/9e0f57a4a4c6c629fa6d0a593acb7d089b1d95cd/src/core/Entry.cpp#L886-L936)).
- **Size calculation:** each client computes history size with its own heuristic (`PwEntry.GetSize` vs `Entry::size`), so the byte limit is approximate across clients.
- KeePassDX reads and writes these Meta fields ([KDX `database/file/input/DatabaseInputKDBX.kt#L395-L419`](https://github.com/Kunzisoft/KeePassDX/blob/2db52c5fd016aad50352ba60383f6aefd29100c4/database/src/main/java/com/kunzisoft/keepass/database/file/input/DatabaseInputKDBX.kt#L395-L419)).

#### Tags

- **Element:** a `Tags` element on Entry, and on Group since KDBX 4.1 (KDBX 4.1 spec, "Group Tags"). KeePass 2.x writes 4.1 as soon as any group has tags (KP2 `KeePassLib/Serialization/KdbxFile.cs:351-397`).
- **Delimiters by client:**

  | Client | Writes | Splits on | Other behaviour |
  |---|---|---|---|
  | KeePass 2.x | `;` | `,` `;` | Replaces `,;` inside a tag with `.` (KP2 `KeePassLib/Utility/StrUtil.cs:1534-1640`) |
  | KeePassXC | `,` | `,` `;` `\t` | Trims, de-duplicates and **sorts** tags ([`src/core/Entry.cpp#L42`, `#L195-L198`, `#L717-L728`](https://github.com/keepassxreboot/keepassxc/blob/9e0f57a4a4c6c629fa6d0a593acb7d089b1d95cd/src/core/Entry.cpp#L717-L728)) |
  | KeePassDX | `,` | `,` `;` | ([KDX `database/element/Tags.kt#L39`, `#L146-L153`](https://github.com/Kunzisoft/KeePassDX/blob/2db52c5fd016aad50352ba60383f6aefd29100c4/database/src/main/java/com/kunzisoft/keepass/database/element/Tags.kt#L39-L153)) |
  | Strongbox | `;` | `;` `:` `,` | Joins from an `NSSet`, so order is not stable ([SBX `model/Utils.m#L96-L97`](https://github.com/strongbox-password-safe/Strongbox/blob/c70fc7b021d9dfa2b18a6d7e13406e717dd5251a/model/Utils.m#L96-L97), [`model/keepass/Entry.m#L207`](https://github.com/strongbox-password-safe/Strongbox/blob/c70fc7b021d9dfa2b18a6d7e13406e717dd5251a/model/keepass/Entry.m#L207)) |

- **Reserved tags:** `Passkey` (KeePassXC, KeePassDX), `OTP` (KeePassDX), and `Favorite` / `Apple Watch` (Strongbox, [`StrongBox/Constants.m#L40-L41`](https://github.com/strongbox-password-safe/Strongbox/blob/c70fc7b021d9dfa2b18a6d7e13406e717dd5251a/StrongBox/Constants.m#L40-L41)).
- **Implication for rimlock:** split on `,` and `;`. Write `;`, which is the format owner's choice. Leave the `Tags` text byte-identical when the tag set did not change. Avoid `:` in tags because Strongbox splits on it.

#### Icons

- **Built-in:** `IconID` 0–68 from the `PwIcon` enum (KP2 `KeePassLib/PwEnums.cs:81-156`; `TrashBin` = 43).
- **Custom:** custom icons live in Meta `CustomIcons` as `{UUID, Data}` (PNG), plus `Name` and `LastModificationTime` in 4.1. Deleting one creates a `DeletedObject` (KDBX 4.1 spec). Entries and groups reference them through `CustomIconUUID`.

#### Expiry

- **Format:** `Times/Expires` + `Times/ExpiryTime`. In KDBX 4, times are base64 of a little-endian int64 counting seconds since 0001-01-01 UTC. KDBX 3.1 uses ISO-8601 with a `Z` suffix ([KXC `src/format/KdbxXmlWriter.cpp#L353-L366`, `#L547-L566`](https://github.com/keepassxreboot/keepassxc/blob/9e0f57a4a4c6c629fa6d0a593acb7d089b1d95cd/src/format/KdbxXmlWriter.cpp#L547-L566)).
- **Client behaviour:**
  - KeePassXC-Browser access is denied for expired entries unless "allow expired credentials" is on, and the entry is flagged `expired` ([KXC `BrowserService.cpp#L1199-L1201`, `#L1230-L1232`](https://github.com/keepassxreboot/keepassxc/blob/9e0f57a4a4c6c629fa6d0a593acb7d089b1d95cd/src/browser/BrowserService.cpp#L1227-L1246)).
  - KeePassDX search excludes expired entries by default.

#### Notes

- **Format:** `Notes` is a plain multi-line standard string. No client renders Markdown into the file.
- **Conventions that live in Notes:**
  - Strongbox can append `\n-----------------------------------------\nStrongbox TOTP Auth URL: [otpauth://…]` and reads any otpauth URL in Notes ([SBX `model/NodeFields.m#L37-L43`, `#L770-L776`](https://github.com/strongbox-password-safe/Strongbox/blob/c70fc7b021d9dfa2b18a6d7e13406e717dd5251a/model/NodeFields.m#L770-L776)).
  - `Auto-Type:` / `Auto-Type-Window:` lines in Notes are a KeePass **1.x (KDB)** convention. They are only parsed on KDB import (KP2 `KeePass/DataExchange/Formats/KeePassKdb1.cs:78`; KXC [`src/format/KeePass1Reader.cpp#L712`](https://github.com/keepassxreboot/keepassxc/blob/9e0f57a4a4c6c629fa6d0a593acb7d089b1d95cd/src/format/KeePass1Reader.cpp#L712)), not on KDBX.
- **Implication for rimlock:** treat Notes as opaque text, apart from optionally detecting otpauth URLs in it.

#### Passkeys

- **Attributes:** the set is defined in [KXC `src/core/EntryAttributes.cpp#L45-L61`](https://github.com/keepassxreboot/keepassxc/blob/9e0f57a4a4c6c629fa6d0a593acb7d089b1d95cd/src/core/EntryAttributes.cpp#L45-L61).
- **What KeePassXC writes** ([`src/browser/BrowserService.cpp#L833-L870`](https://github.com/keepassxreboot/keepassxc/blob/9e0f57a4a4c6c629fa6d0a593acb7d089b1d95cd/src/browser/BrowserService.cpp#L833-L870)):
  - `KPEX_PASSKEY_USERNAME`
  - `KPEX_PASSKEY_CREDENTIAL_ID` (protected)
  - `KPEX_PASSKEY_PRIVATE_KEY_PEM` (protected; PKCS#8 `-----BEGIN PRIVATE KEY-----`)
  - `KPEX_PASSKEY_RELYING_PARTY` (the rpId)
  - `KPEX_PASSKEY_USER_HANDLE` (protected)
  - `KPEX_PASSKEY_FLAG_BE` = `"1"` and `KPEX_PASSKEY_FLAG_BS` = `"1"`
  - the tag `Passkey`
- **Encoding:** credential IDs are base64url without padding ([`src/browser/BrowserMessageBuilder.cpp#L384-L410`](https://github.com/keepassxreboot/keepassxc/blob/9e0f57a4a4c6c629fa6d0a593acb7d089b1d95cd/src/browser/BrowserMessageBuilder.cpp#L384-L410)).
- **Strongbox aliases:** KeePassXC also reads `KPEX_PASSKEY_GENERATED_USER_ID` (instead of `CREDENTIAL_ID`) and `KPXC_PASSKEY_USERNAME`, for Strongbox compatibility ([`src/browser/PasskeyUtils.cpp#L383-L405`](https://github.com/keepassxreboot/keepassxc/blob/9e0f57a4a4c6c629fa6d0a593acb7d089b1d95cd/src/browser/PasskeyUtils.cpp#L383-L405)). Strongbox's constants are the same set ([SBX `StrongBox/Constants.m#L66-L73`](https://github.com/strongbox-password-safe/Strongbox/blob/c70fc7b021d9dfa2b18a6d7e13406e717dd5251a/StrongBox/Constants.m#L66-L73)).
- **KeePassDX** reuses the KeePassXC names and adds `KPEX_PASSKEY_PRF`. A passkey is detected by the `Passkey` tag or by any of these fields ([KDX `model/PasskeyEntryFields.kt#L12-L80`](https://github.com/Kunzisoft/KeePassDX/blob/2db52c5fd016aad50352ba60383f6aefd29100c4/database/src/main/java/com/kunzisoft/keepass/model/PasskeyEntryFields.kt#L12-L80)).
- **Effect on URL matching:** `KPEX_PASSKEY_RELYING_PARTY` takes part in KeePassXC URL matching (§1.1).
- **Implication for rimlock (MVP):** preserve every `KPEX_*` / `KPXC_*` string, including its `Protected` flag.

#### Other things to preserve verbatim

- The `Protected` flag on each string, which KeePassXC sets for `otp` and passkey secrets.
- `AutoType` blocks, `OverrideURL`, `ForegroundColor` / `BackgroundColor`, and `QualityCheck` (4.1; KeePassXC also honours legacy `KnownBad`, [`src/core/Entry.cpp#L246-L256`](https://github.com/keepassxreboot/keepassxc/blob/9e0f57a4a4c6c629fa6d0a593acb7d089b1d95cd/src/core/Entry.cpp#L246-L256)).
- CustomData item `LastModificationTime` (4.1).
- KeePassDX `_etm_*` template fields ([KDX `database/element/template/TemplateEngineCompatible.kt#L413-L417`](https://github.com/Kunzisoft/KeePassDX/blob/2db52c5fd016aad50352ba60383f6aefd29100c4/database/src/main/java/com/kunzisoft/keepass/database/element/template/TemplateEngineCompatible.kt#L413-L417)).
- KDBX 4 outer-header `PublicCustomData` (`KPXC_PUBLIC_*`, [KXC `src/core/Database.cpp#L1172-L1223`](https://github.com/keepassxreboot/keepassxc/blob/9e0f57a4a4c6c629fa6d0a593acb7d089b1d95cd/src/core/Database.cpp#L1172-L1223)).
- Attachments (`Binary` refs plus inner-header binaries).
- Unknown XML elements: **neither KeePass 2.x nor KeePassXC keeps them**. KeePass skips them via `ReadUnknown` (KP2 `KeePassLib/Serialization/KdbxFile.Read.Streamed.cs:185-196`); KeePassXC via `skipCurrentElement` ([`src/format/KdbxXmlReader.cpp#L236`](https://github.com/keepassxreboot/keepassxc/blob/9e0f57a4a4c6c629fa6d0a593acb7d089b1d95cd/src/format/KdbxXmlReader.cpp#L236)). Rimlock can be stricter and keep them, but must not rely on other clients keeping rimlock-specific XML. **Rimlock data should go in CustomData or string fields, never in new XML elements.**

#### File format version

- **KeePass 2.61** always writes at least KDBX 4. It writes 4.1 only when there are group tags, `QualityCheck=false`, named or timestamped custom icons, or timestamped Meta CustomData (KP2 `KdbxFile.cs:351-397`).
- **KeePassXC** writes the minimum version the content needs: 3.1 → 4 (non-AES KDF, any entry/group CustomData, public custom data) → 4.1 ([`src/format/KeePass2Writer.cpp#L52-L108`](https://github.com/keepassxreboot/keepassxc/blob/9e0f57a4a4c6c629fa6d0a593acb7d089b1d95cd/src/format/KeePass2Writer.cpp#L52-L108)).
- **Implication for rimlock:** keep the file's existing version unless the content requires an upgrade.

### 4. Field references and placeholders

#### Field references

- **Syntax:** `{REF:<WantedField>@<SearchIn>:<Text>}`. The codes are T=Title, U=UserName, P=Password, A=URL, N=Notes, I=UUID, and O=other custom strings, which is valid as *SearchIn only*. If several entries match, the first one is used, so use `@I:` to avoid ambiguity (KP2 `Docs/Chm/help/base/fieldrefs.html`).
- **KeePass 2.x resolution:**
  - Searches with the normal entry search: case-insensitive substring match, ignoring the "searching disabled" setting.
  - Recurses up to depth 12, and caches results per compile (KP2 `KeePass/Util/Spr/SprEngine.cs:51`, `:559-660`).
  - `{REF:P@…}` may prompt a confirmation in "active" contexts.
- **KeePassXC resolution:**
  - Parses with the regex `\{REF:(?<WantedField>[TUPANI])@(?<SearchIn>[TUPANIO]):(?<SearchText>…)\}` ([`src/core/EntryPlaceholders.cpp#L189-L194`](https://github.com/keepassxreboot/keepassxc/blob/9e0f57a4a4c6c629fa6d0a593acb7d089b1d95cd/src/core/EntryPlaceholders.cpp#L189-L194)).
  - **Matches by exact equality**, not substring. `O` matches any attribute value exactly ([`src/core/Group.cpp#L653-L698`](https://github.com/keepassxreboot/keepassxc/blob/9e0f57a4a4c6c629fa6d0a593acb7d089b1d95cd/src/core/Group.cpp#L653-L698)).
  - Maximum depth is 10 ([`src/core/EntryPlaceholders.h#L26`](https://github.com/keepassxreboot/keepassxc/blob/9e0f57a4a4c6c629fa6d0a593acb7d089b1d95cd/src/core/EntryPlaceholders.h#L26)).
  - Always *creates* references as `{REF:X@I:<UUID uppercase hex>}` ([`src/core/Entry.cpp#L110-L135`](https://github.com/keepassxreboot/keepassxc/blob/9e0f57a4a4c6c629fa6d0a593acb7d089b1d95cd/src/core/Entry.cpp#L110-L135)).
- **KeePassDX:** supports `{REF:}` and `{S:}`, with recursion depth 10 and at most 10 inline refs ([KDX `database/element/entry/FieldReferencesEngine.kt#L53-L64`, `#L189-L193`](https://github.com/Kunzisoft/KeePassDX/blob/2db52c5fd016aad50352ba60383f6aefd29100c4/database/src/main/java/com/kunzisoft/keepass/database/element/entry/FieldReferencesEngine.kt#L53-L193)).
- **Strongbox:** supports `{TITLE}` `{USERNAME}` `{URL[:RMVSCM|HOST|SCM|PORT|PATH|QUERY|USERNAME|USERINFO|PASSWORD]}` `{PASSWORD}` `{NOTES}` `{TIMEOTP}` `{TOTP}` `{S:…}` `{REF:…}` ([SBX `model/SprCompilation.m#L45`](https://github.com/strongbox-password-safe/Strongbox/blob/c70fc7b021d9dfa2b18a6d7e13406e717dd5251a/model/SprCompilation.m#L45)).

#### Placeholders

- **Case:** placeholders are case-insensitive (KP2 `Docs/Chm/help/base/placeholders.html`).
- **KeePass 2.x supported set** (KP2 `SprEngine.cs:160-200`, `:386-470`):
  - Entry fields: `{TITLE}` `{USERNAME}` `{URL}` `{PASSWORD}` `{NOTES}` `{S:Name}` `{UUID}`.
  - URL parts: `{URL:RMVSCM|SCM|HOST|PORT|PATH|QUERY|USERINFO|USERNAME|PASSWORD}`.
  - Group: `{GROUP}` `{GROUP_PATH}` `{GROUP_NOTES}`.
  - OTP: `{TIMEOTP}` `{HMACOTP}`.
  - Transforms: `{T-CONV:/…/…/}` `{T-REPLACE-RX:/…/…/…/}`.
  - Dates: `{DT_*}` / `{DT_UTC_*}`.
  - Paths: `{DB_*}`, `{APPDIR}`, `%ENV%`.
  - Other: `{C:…}`, `{CMD:…}`, `{PICKCHARS}`, `{NEWPASSWORD}`, `{BASE…}`, `{CLIPBOARD…}`.
- **KeePassXC supported set** ([`src/core/EntryPlaceholders.cpp#L36-L87`](https://github.com/keepassxreboot/keepassxc/blob/9e0f57a4a4c6c629fa6d0a593acb7d089b1d95cd/src/core/EntryPlaceholders.cpp#L36-L87)):
  - The entry fields, `{S:}`, `{REF:}` and `{UUID}`.
  - `{TOTP}` / `{TIMEOTP}`.
  - `{URL:*}`, plus `{URL:FRAGMENT}`, `{URL:SCHEME}` and `{URL:WITHOUTSCHEME}`.
  - `{DT_*}`, `{DB_DIR}`, `{T-CONV}` and `{T-REPLACE-RX}`.
- **What KeePassXC sends to the browser:** username, password and title, each after `resolveMultiplePlaceholders` ([`BrowserService.cpp#L1188-L1195`](https://github.com/keepassxreboot/keepassxc/blob/9e0f57a4a4c6c629fa6d0a593acb7d089b1d95cd/src/browser/BrowserService.cpp#L1188-L1195)).
- **Recommended set for rimlock autofill** (the intersection all clients honour):
  - `{REF:…}` with W ∈ TUPANI and S ∈ TUPANIO.
  - `{S:Name}`, `{TITLE}`, `{USERNAME}`, `{PASSWORD}`, `{URL}`, `{NOTES}`, `{UUID}`.
  - `{URL:RMVSCM|SCM|HOST|PORT|PATH|QUERY|USERINFO|USERNAME|PASSWORD}`.
  - `{TIMEOTP}` / `{TOTP}`.
  - `{T-CONV}` and `{T-REPLACE-RX}` are optional.
  - **Never execute** `{CMD:}` or `cmd://`, and never resolve `{CLIPBOARD}`, `{PICKCHARS}`, `{NEWPASSWORD}` or `{HMACOTP}`. `{HMACOTP}` would mutate the database.
  - Leave unknown placeholders as literal text, as KeePassXC does.
  - Resolve REF search text by exact match first, then fall back to KeePass-style case-insensitive substring. Create new references only as `@I:<UUID>`.

## Open risks / unknowns

1. **Additional-URL naming is split between clients.** KeePassXC uses `KP2A_URL[_n]` and KeePassDX uses `URL_n`.
   - KeePassDX autofill origin parsing only reads `URL_n`. Its search does find `KP2A_URL*`.
   - KeePassXC ignores `URL_n` completely.
   - Rimlock reading both is safe. Which name to *write* needs a decision; recommendation: `KP2A_URL*`.
2. **TOTP precedence differs between clients.** KeePassXC prefers `TOTP Settings` first, while KeePassDX and Strongbox prefer `otp` first. KeePassXC edits leave stale `TimeOtp-*` fields. Dual-writing therefore needs an "update every present representation" rule, which belongs in an ADR.
3. **KeePassXC reads only `TimeOtp-Secret-Base32`.** Entries created in KeePass 2.x with `TimeOtp-Secret` (UTF-8), `-Hex` or `-Base64` show no TOTP in KeePassXC. Rimlock can read all variants.
4. **CustomData booleans differ in case.** KeePassXC writes `"true"` and compares case-sensitively; Strongbox writes `"True"`. Rimlock should read case-insensitively and write each owner's own casing.
5. **Writing entry/group CustomData forces KDBX ≥ 4.** If a user keeps a KDBX 3.1 file for a very old client, rimlock must not add CustomData silently, or must warn first.
6. **Tag delimiters and order.** KeePassXC re-sorts tags and Strongbox reorders them through a set, so a "no-op" round trip through those clients changes the `Tags` text. Rimlock should compare tag *sets* before writing. Tags containing `:` break in Strongbox.
7. **The history size limit is approximate across clients.** Byte-size heuristics differ (`PwEntry.GetSize` vs `Entry::size`), so trimming results can differ by an item. This is acceptable, but rimlock should not trim history it did not create on an entry it did not edit.
8. **Field-reference matching differs.** KeePass uses case-insensitive substring search; KeePassXC uses exact equality. A non-`@I:` REF can resolve to a different entry in each client.
9. **KeePass 2.x core has no browser-matching metadata.** Its users rely on plugins: KeePassRPC/Kee (`KPRPC JSON`), KeePassNatMsg / KeePassHttp (`KeePassHttp Settings`, a legacy name KeePassXC still declares at [`BrowserService.cpp#L62`](https://github.com/keepassxreboot/keepassxc/blob/9e0f57a4a4c6c629fa6d0a593acb7d089b1d95cd/src/browser/BrowserService.cpp#L62)). Rimlock should preserve these and could later read `KPRPC JSON` for alternative URLs. That schema was not researched here.
10. **Sources not checked:** Keepass2Android itself (the originator of `KP2A_URL`) and KeePassium were not inspected. KeePassium is an iOS/macOS alternative to Strongbox and may have its own TOTP and URL conventions.
11. **Sources not reachable:** keepass.info could not be fetched directly (bot check), so the KDBX 4.1 spec was read from the Wayback Machine (2026-06-29), and the KeePass help pages from the 2.61 source zip. KeePass 2.62, if it exists, was not on SourceForge.
