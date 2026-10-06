# KeePass conventions: Keepass2Android, KeePassium and Kee

Research for [#18](https://github.com/maxdubmors/rimlock/issues/18), extending [#6](https://github.com/maxdubmors/rimlock/issues/6) ([findings](https://github.com/maxdubmors/rimlock/blob/research/keepass-conventions/docs/research/keepass-conventions.md), called "the #6 doc" below). Date: 2026-10-06.

## Question

Which conventions do Keepass2Android (KP2A), KeePassium and Kee (KeePassRPC plus the Kee browser add-on) use that the #6 doc did not cover, and which of them must rimlock read, write or preserve? In scope:

- Extra-URL storage, including the `KPRPC JSON` schema.
- TOTP formats.
- Per-Entry autofill settings.
- Anything else these clients write into a Database that rimlock must preserve.

Findings already in the #6 doc are not repeated. That includes KeePassXC, KeePassDX, Strongbox and KeePass 2.x behaviour, the TOTP field names, and the passkey attribute set.

## Sources

All claims cite code at a pinned revision:

| Project | Revision | Link prefix used below |
|---|---|---|
| Keepass2Android | `76d8502a` (main, 2026-10-05) | [KP2A](https://github.com/PhilippC/keepass2android/tree/76d8502a2e42a10267bfb626c6292ec02fcf48c0) |
| KeePassium | `e651df4f` (master, 2026-05-23; CHANGELOG head 2.6.173) | [KPM](https://github.com/keepassium/KeePassium/tree/e651df4f89b0b8550371566ca9aa55a964d2904e) |
| KeePassRPC | `dc0a59b6` (master, 2024-07-04, `KeePassRPC:2.0.2`; the same revision as the #6 doc) | [KRPC](https://github.com/kee-org/keepassrpc/tree/dc0a59b60b3ac21da9944bc5b98fe96e706af80a) |
| Kee browser add-on | `4bd94e2d` (master, 2024-11-07, `package.json` 4.1.0) | [KEE](https://github.com/kee-org/browser-addon/tree/4bd94e2d8fbcf88b7064b09efb0ae986fa4bda16) |

Both Kee repositories have had no commits since 2024. Kee is in maintenance mode, so these revisions are the current state.

## Summary

| Convention | Storage location / format | Reads | Writes |
|---|---|---|---|
| Additional URLs, KP2A style | String fields `KP2A_URL_1`, `KP2A_URL_2`, … (KP2A starts at `_1` and never writes bare `KP2A_URL`) | KP2A (full-text search fallback only), KeePassium (any custom field, substring), plus KeePassXC / Strongbox / KeePassDX per the #6 doc | KP2A (when it adds a URL to an existing entry) |
| Additional URLs, KeePassium style | `KP2A_URL`, then `KP2A_URL_1`, `KP2A_URL_2`, … (first free index; same as KeePassXC) | KeePassium | KeePassium ("add URL" in the editor) |
| Android app IDs, KP2A style | String fields `AndroidApp1`, `AndroidApp2`, … (**no underscore**). Value is the full `androidapp://<package>` URI. | KP2A (text search) | KP2A |
| Android app ID, KP2A primary | `URL` = `androidapp://<package>` (when the entry is created from an app) | KP2A | KP2A, KP2A plugin SDK |
| Extra URL from KeePass `OverrideURL` | Entry `<OverrideURL>` element | KeePassium (scored like a second URL) | KeePass 2.x / KeePassium editor |
| Kee entry config v2 | Entry **CustomData** `KPRPC JSON` = Jayrock JSON `{"version":2,"altUrls":[…],"blockedUrls":[…],"regExUrls":[…],"regExBlockedUrls":[…],"httpRealm":…,"authenticationMethods":[…],"behaviour":…,"matcherConfigs":[…],"fields":[…]}` | KeePassRPC | KeePassRPC (every entry it creates or updates) |
| Kee entry config v1 (legacy) | Entry **string** `KPRPC JSON` (Protected) = `{"version":1,"hTTPRealm":…,"formFieldList":[…],"alwaysAutoFill":…,"neverAutoFill":…,"alwaysAutoSubmit":…,"neverAutoSubmit":…,"priority":…,"altURLs":[…],"hide":…,"blockedURLs":[…],"regExURLs":[…],"regExBlockedURLs":[…],"blockHostnameOnlyMatch":…,"blockDomainOnlyMatch":…}` | KeePassRPC (only when no v2 exists) | Nobody now. The KeePass entry dialog deletes it when it writes v2; the RPC path leaves it in place. |
| Kee database config | Meta CustomData `KeePassRPC.Config` = JSON `{version:3, rootUUID, defaultMatchAccuracy, matchedURLAccuracyOverrides, defaultPlaceholderHandling}`. Legacy keys: `KeePassRPC.KeeFox.rootUUID`, `KeePassRPC.KeeFox.configVersion` (deleted on open). | KeePassRPC | KeePassRPC (on DB create/open and in settings) |
| Hide from Kee | `KPRPC JSON` v2 `matcherConfigs` contains `{"matcherType":"Hide"}` (v1: `"hide":true`) | KeePassRPC | KeePassRPC |
| Kee autofill/submit behaviour | `KPRPC JSON` v2 `behaviour` ∈ `NeverAutoFillNeverAutoSubmit`, `NeverAutoSubmit`, `AlwaysAutoFillAlwaysAutoSubmit`, `AlwaysAutoFill`, `AlwaysAutoFillNeverAutoSubmit` (absent means Default) | KeePassRPC → Kee | KeePassRPC |
| Per-entry autofill exclusion (KeePassium) | Entry `<AutoType><Enabled>False</Enabled>` | KeePassium | KeePassium ("AutoFill" toggle), KeePass 2.x, KeePassXC |
| Per-group autofill exclusion (KeePassium) | Group `EnableAutoType` (`True`/`False`/`null`, inherited) and `EnableSearching` | KeePassium | KeePassium, KeePass 2.x, KeePassXC |
| KeePassXC hide flag, as seen by KeePassium | Entry CustomData `BrowserHideEntry` (`"true"`/`"false"`, read case-insensitively). Entry level only; group values are ignored. | KeePassium | KeePassium, but only on an entry that already has the key |
| KP2A autofill "disable for this site/app" | Not in the Database: Android SharedPreferences `AutoFillDisabledQueries` | — | — |
| TOTP `otp` = otpauth URI | String `otp` | KP2A (algorithm only `SHA256`/`SHA512`, case-sensitive), KeePassium | KeePassium (default; Protected) |
| TOTP `otp` = KeeOtp `key=…&step=…&size=…` | String `otp` | KP2A (ignores `otpHashMode`), KeePassium (honours `otpHashMode`, `type`) | not written by either |
| TOTP `TOTP Seed` + `TOTP Settings` | Strings; settings `period;digits[;timeCorrectionURL]`, digits ∈ `6`,`8`,`S` | KP2A (field names configurable, period 1–60 only), KeePassium (any digits) | neither |
| TOTP KeePass 2.x native | `TimeOtp-Secret[-Hex/-Base32/-Base64]`, `-Length`, `-Period`, `-Algorithm` | KP2A (all four encodings), KeePassium (**only `-Base32`**) | neither |
| Passkey | `KPEX_PASSKEY_*` (KeePassXC set) | KeePassium (needs all five core fields) | KeePassium (`FLAG_BE`/`FLAG_BS` = `"1"`/`"0"`, no `Passkey` tag). KP2A has no passkey support. |
| KeeAutoExec / child databases | Group named `AutoOpen` (case-insensitive). Entry strings `Enabled`, `Visible`, `Priority`, `SkipIfNotExists`, `IfDevice` (CSV, `!name` excludes), `Focus`, `IocUserName`, `IocPassword`, `IocTimeout`, `IocUserAgent`. URL = path of the child DB. | KP2A | KP2A (`IfDevice`, and creates AutoOpen entries) |
| KP2A templates | Template entries with `_etm_template="1"`, `_etm_*` fields and `KP2A_TemplateId` (hex UUID) | KP2A | KP2A |

## Findings

### 1. Keepass2Android

#### 1.1 Additional URLs and Android apps

- **Write:** KP2A writes an extra URL in `Util.SetNextFreeUrlField`. The name prefix is `KP2A_URL_` for web URLs and `AndroidApp` for `androidapp://` URIs. The counter starts at **1**, and the value is stored unprotected and unchanged ([KP2A `src/keepass2android-app/Utils/Util.cs#L941-L951`](https://github.com/PhilippC/keepass2android/blob/76d8502a2e42a10267bfb626c6292ec02fcf48c0/src/keepass2android-app/Utils/Util.cs#L941-L951)). This produces `KP2A_URL_1`, `KP2A_URL_2`, … and `AndroidApp1`, `AndroidApp2`, …. The scheme constant is `androidapp://` ([`KeePass.cs#L89`](https://github.com/PhilippC/keepass2android/blob/76d8502a2e42a10267bfb626c6292ec02fcf48c0/src/keepass2android-app/KeePass.cs#L89)).
- **When it writes:**
  - A web URL goes into `URL` only if `URL` is empty.
  - Otherwise it goes to the next free field ([`EntryActivity.cs#L1572-L1578`](https://github.com/PhilippC/keepass2android/blob/76d8502a2e42a10267bfb626c6292ec02fcf48c0/src/keepass2android-app/EntryActivity.cs#L1572-L1578), [`app/AppTask.cs#L819`](https://github.com/PhilippC/keepass2android/blob/76d8502a2e42a10267bfb626c6292ec02fcf48c0/src/keepass2android-app/app/AppTask.cs#L819)).
  - An app ID always goes to `AndroidAppN`.
- **Comparison with KeePassDX:** KeePassDX writes `AndroidApp`, `AndroidApp_1`, … with the bare package name and stops reading at the first gap (the #6 doc, [KDX `AppOriginEntryField.kt#L36-L57`](https://github.com/Kunzisoft/KeePassDX/blob/2db52c5fd016aad50352ba60383f6aefd29100c4/database/src/main/java/com/kunzisoft/keepass/model/AppOriginEntryField.kt#L36-L57)). KeePassDX's *structured* reader therefore never sees KP2A's `AndroidApp1` = `androidapp://pkg`, and KP2A never sees KeePassDX's `AndroidApp`.
- **Matching:** `GetSearchResultsForUrl` is the entry point for both the Android Autofill service and the share-URL flow ([`ShareUrlResults.cs#L213-L235`](https://github.com/PhilippC/keepass2android/blob/76d8502a2e42a10267bfb626c6292ec02fcf48c0/src/keepass2android-app/ShareUrlResults.cs#L213-L235), [`services/Kp2aAutofill/Kp2aAutofillService.cs#L52-L58`](https://github.com/PhilippC/keepass2android/blob/76d8502a2e42a10267bfb626c6292ec02fcf48c0/src/keepass2android-app/services/Kp2aAutofill/Kp2aAutofillService.cs#L52-L58)). It tries these steps in order until one returns results:
  1. Substring search of the query in the `URL` field only (`SearchInUrls`, [`Kp2aBusinessLogic/SearchDbHelper.cs#L71-L90`](https://github.com/PhilippC/keepass2android/blob/76d8502a2e42a10267bfb626c6292ec02fcf48c0/src/Kp2aBusinessLogic/SearchDbHelper.cs#L71-L90)).
  2. For web queries only, host equality on the **primary `URL` only**, after `{REF}` resolution.
  3. The same, but also accepting a site host that ends with `.`+entry host, with a leading `www.` removed from the entry host ([`SearchDbHelper.cs#L122-L147`](https://github.com/PhilippC/keepass2android/blob/76d8502a2e42a10267bfb626c6292ec02fcf48c0/src/Kp2aBusinessLogic/SearchDbHelper.cs#L122-L147)).
  4. A full-text search for the query.
  5. A full-text search for the query's host.

  The full-text search covers titles, user names, URL, notes, tags and **all other strings** (defaults [`KeePassLib2Android/PwDefs.cs#L271-L390`](https://github.com/PhilippC/keepass2android/blob/76d8502a2e42a10267bfb626c6292ec02fcf48c0/src/KeePassLib2Android/PwDefs.cs#L271-L390)). It respects "searching disabled" and does not exclude expired entries.

  So `KP2A_URL_n` and `AndroidAppN` only take part through the full-text fallback (steps 4 and 5). That fallback is a substring match of the domain or package against any field, which means a `KP2A_URL_1` entry is found, but so is any entry whose notes mention that domain.
- **Autofill query format:** the Android autofill query is the web domain reported by the browser, or `androidapp://<package>` for apps ([`Kp2aAutofillParser/AutofillParser.cs#L796-L815`](https://github.com/PhilippC/keepass2android/blob/76d8502a2e42a10267bfb626c6292ec02fcf48c0/src/Kp2aAutofillParser/AutofillParser.cs#L796-L815)).

#### 1.2 Per-entry autofill settings

- KP2A has **no per-entry or per-group autofill flag in the Database**. It does not read `BrowserHideEntry`, `KPEX_DoNotSuggestForAutoFill`, `KPRPC JSON` or `AutoType/Enabled`, and none of these names occur in its source.
- "Disable autofill for this site/app" is stored in the device's SharedPreferences set `AutoFillDisabledQueries` ([`services/AutofillBase/AutofillServiceBase.cs#L442-L449`](https://github.com/PhilippC/keepass2android/blob/76d8502a2e42a10267bfb626c6292ec02fcf48c0/src/keepass2android-app/services/AutofillBase/AutofillServiceBase.cs#L442-L449)).
- KP2A's code does not use CustomData at all. Its KeePassLib fork still reads and writes CustomData and never saves a KDBX version lower than the one it read ([`KeePassLib2Android/Serialization/KdbxFile.cs#L382-L390`](https://github.com/PhilippC/keepass2android/blob/76d8502a2e42a10267bfb626c6292ec02fcf48c0/src/KeePassLib2Android/Serialization/KdbxFile.cs#L382-L390)). Like KeePass 2.x, it drops unknown XML elements (`ReadUnknown`, [`Serialization/KdbxFile.Read.Streamed.cs#L185`](https://github.com/PhilippC/keepass2android/blob/76d8502a2e42a10267bfb626c6292ec02fcf48c0/src/KeePassLib2Android/Serialization/KdbxFile.Read.Streamed.cs#L185)).

#### 1.3 TOTP

- **Read order** is fixed: TrayTotp, then KeeOtp, then KeeWeb `otpauth`, then KeePass 2 `TimeOtp-*` ([`Totp/Kp2aTotp.cs#L30-L36`](https://github.com/PhilippC/keepass2android/blob/76d8502a2e42a10267bfb626c6292ec02fcf48c0/src/keepass2android-app/Totp/Kp2aTotp.cs#L30-L36)). The first adapter that recognises the entry wins.
  - **TrayTotp** ([`Totp/TrayTotpPluginAdapter.cs#L40-L171`](https://github.com/PhilippC/keepass2android/blob/76d8502a2e42a10267bfb626c6292ec02fcf48c0/src/keepass2android-app/Totp/TrayTotpPluginAdapter.cs#L40-L171)):
    - The field names come from user preferences, defaulting to `TOTP Seed` / `TOTP Settings`.
    - Settings are `period;length[;url]`. The period must be 1–60, and the length must be `6`, `8` or `S` (Steam). A third element starting with `http(s)://` is a time-correction URL, which KP2A does not implement.
    - When `TOTP Settings` is missing, the default is `30;6`.
  - **KeeOtp** ([`Totp/KeeOtpPluginAdapter.cs#L54-L88`](https://github.com/PhilippC/keepass2android/blob/76d8502a2e42a10267bfb626c6292ec02fcf48c0/src/keepass2android-app/Totp/KeeOtpPluginAdapter.cs#L54-L88)): reads `otp` = `key=…&step=…&size=…`. **`otpHashMode` is ignored**, so a KeeOtp SHA-256 entry yields wrong codes in KP2A.
  - **KeeWeb `otpauth`** ([`Totp/KeeWebOtpPluginAdapter.cs#L26-L72`](https://github.com/PhilippC/keepass2android/blob/76d8502a2e42a10267bfb626c6292ec02fcf48c0/src/keepass2android-app/Totp/KeeWebOtpPluginAdapter.cs#L26-L72)):
    - Requires the `otp` value to start with `otpauth://totp/`.
    - Reads `secret`, `digits`, `period` and `encoder`.
    - Recognises `algorithm` only as the exact strings `SHA512` or `SHA256`. Anything else, including `sha256` or `HMAC-SHA-256`, silently falls back to SHA-1.
  - **KeePass 2 `TimeOtp-*`** ([`Totp/Keepass2TotpPluginAdapter.cs#L29-L109`](https://github.com/PhilippC/keepass2android/blob/76d8502a2e42a10267bfb626c6292ec02fcf48c0/src/keepass2android-app/Totp/Keepass2TotpPluginAdapter.cs#L29-L109)): reads `TimeOtp-Secret`, then `-Hex`, then `-Base32`, then `-Base64`, plus `-Period`, `-Length` and `-Algorithm`.
- **KP2A never writes TOTP config.** The displayed `TOTP` value is a computed, in-memory output string ([`Totp/UpdateTotpTimerTask.cs#L76`](https://github.com/PhilippC/keepass2android/blob/76d8502a2e42a10267bfb626c6292ec02fcf48c0/src/keepass2android-app/Totp/UpdateTotpTimerTask.cs#L76)). Users enter the fields by hand as custom strings.
- **Implication:** when rimlock writes `otpauth` for KP2A users, it should write `algorithm=SHA256`/`SHA512` in exactly that case, or omit it for SHA-1. KeePassXC already accepts `SHA256`. Periods above 60 only work in KP2A through `otp` or `TimeOtp-*`, not through the legacy pair.

#### 1.4 Other data KP2A writes that rimlock must preserve

- **KeeAutoExec / child databases** ([`KeeAutoExec.cs#L101-L110`, `#L113-L147`, `#L270-L300`](https://github.com/PhilippC/keepass2android/blob/76d8502a2e42a10267bfb626c6292ec02fcf48c0/src/keepass2android-app/KeeAutoExec.cs#L101-L300)):
  - KP2A reads entries of any group named `AutoOpen` (case-insensitive).
  - The entry strings used are `Enabled`, `Visible`, `Priority`, `IfDevice`, `SkipIfNotExists`, `Focus` and `Ioc*`. The URL is the child DB path, and the password is its master password.
  - KP2A *writes* `IfDevice` (a CSV of device names; `!name` excludes a device) and creates such entries ([`ConfigureChildDatabasesActivity.cs#L360-L380`](https://github.com/PhilippC/keepass2android/blob/76d8502a2e42a10267bfb626c6292ec02fcf48c0/src/keepass2android-app/ConfigureChildDatabasesActivity.cs#L360-L380)). Its editor uses temporary `_ui_*` keys ([`AutoOpenEdit.cs#L33-L37`](https://github.com/PhilippC/keepass2android/blob/76d8502a2e42a10267bfb626c6292ec02fcf48c0/src/keepass2android-app/AutoOpenEdit.cs#L33-L37)).
  - **Rimlock must not offer these entries for web autofill.** Their URL is a file path and their password is a database master key.
- **Templates:** template entries carry `_etm_template="1"`, `_etm_position_*`, `_etm_title_*` and `_etm_type_*`, plus `KP2A_TemplateId` (hex UUID) for de-duplication ([`Kp2aBusinessLogic/database/edit/AddTemplateEntries.cs#L77-L91`, `#L305-L312`, `#L371`](https://github.com/PhilippC/keepass2android/blob/76d8502a2e42a10267bfb626c6292ec02fcf48c0/src/Kp2aBusinessLogic/database/edit/AddTemplateEntries.cs#L305-L312)). This is the same KPEntryTemplates scheme as KeePassDX.
- **Tags:** KP2A uses KeePassLib, which writes `;` and splits on `,;` ([`KeePassLib2Android/Utility/StrUtil.cs#L1399-L1507`](https://github.com/PhilippC/keepass2android/blob/76d8502a2e42a10267bfb626c6292ec02fcf48c0/src/KeePassLib2Android/Utility/StrUtil.cs#L1399-L1507)).

### 2. KeePassium

#### 2.1 Additional URLs and matching

- **Write:** KeePassium names additional URL fields `KP2A_URL` (index 0), then `KP2A_URL_1`, `KP2A_URL_2`, …, taking the first free index. They are unprotected ([KPM `KeePassiumLib/KeePassiumLib/db/kp2/Entry2.swift#L147-L164`](https://github.com/keepassium/KeePassium/blob/e651df4f89b0b8550371566ca9aa55a964d2904e/KeePassiumLib/KeePassiumLib/db/kp2/Entry2.swift#L147-L164)). Any field with the `KP2A_URL` prefix is shown as "URL n" ([`db/EntryField.swift#L26`, `#L78-L93`](https://github.com/keepassium/KeePassium/blob/e651df4f89b0b8550371566ca9aa55a964d2904e/KeePassiumLib/KeePassiumLib/db/EntryField.swift#L78-L93)).
- **Matching does not use the field name.** For a URL request, AutoFill scores every entry ([`KeePassium AutoFill/util/SearchHelper+extensions.swift#L52-L80`, `#L156-L283`](https://github.com/keepassium/KeePassium/blob/e651df4f89b0b8550371566ca9aa55a964d2904e/KeePassium%20AutoFill/util/SearchHelper%2Bextensions.swift#L156-L283)):
  - **Primary `URL`:**
    - 1.0 for an identical URL.
    - For the same host or the same registrable domain: 0.7 + 0.3 × path-prefix similarity, minus 0.2 when the ports differ.
    - 0.5 when only the service name matches (e.g. `example.com` vs `example.org`).
  - **`OverrideURL`:** scored the same way as the primary `URL`.
  - **Title and Notes:** 0.8 if the title contains the domain and 0.5 if the notes do (0.5 / 0.3 when they contain the service name).
  - **Every non-standard field:**
    - 1.0 if the value *contains* the full request URL.
    - 0.95 if it *equals* the main domain.
    - 0.5 if it contains the main domain.
    - 0.3 if it contains the service name.
  - **Results:** a score ≥ 0.99 is an "exact match", lower scores are "partial matches".
- **Domain-only requests** (iOS often supplies only a domain) use a simpler host / main-domain comparison against `URL` and `OverrideURL`, plus a substring search in title, notes and custom fields ([`#L82-L154`](https://github.com/keepassium/KeePassium/blob/e651df4f89b0b8550371566ca9aa55a964d2904e/KeePassium%20AutoFill/util/SearchHelper%2Bextensions.swift#L82-L154)).
- **Passkey lookup** requires exact equality of `KPEX_PASSKEY_RELYING_PARTY` with the rpId ([`#L287-L311`](https://github.com/keepassium/KeePassium/blob/e651df4f89b0b8550371566ca9aa55a964d2904e/KeePassium%20AutoFill/util/SearchHelper%2Bextensions.swift#L287-L311)).
- **Implication:** KeePassium finds additional URLs under either naming scheme (`KP2A_URL*` or `URL_n`). It also treats `OverrideURL` as a URL, which no other client in either study does.

#### 2.2 Per-entry and per-group autofill settings

- **Filter:** an entry is offered for AutoFill only if all of the following hold ([`db/Entry.swift#L11-L31`, `#L95-L103`](https://github.com/keepassium/KeePassium/blob/e651df4f89b0b8550371566ca9aa55a964d2904e/KeePassiumLib/KeePassiumLib/db/Entry.swift#L95-L103); [`db/kp2/Entry2.swift#L34-L63`](https://github.com/keepassium/KeePassium/blob/e651df4f89b0b8550371566ca9aa55a964d2904e/KeePassiumLib/KeePassiumLib/db/kp2/Entry2.swift#L34-L63); [`db/kp2/Group2.swift#L86-L112`](https://github.com/keepassium/KeePassium/blob/e651df4f89b0b8550371566ca9aa55a964d2904e/KeePassiumLib/KeePassiumLib/db/kp2/Group2.swift#L86-L112)):
  - It is not deleted.
  - It is not expired.
  - Its `AutoType/Enabled` is true.
  - Its CustomData `BrowserHideEntry` is not `true`.
  - Its parent group's resolved `EnableSearching` is true.
  - Its parent group's resolved `EnableAutoType` is true. `null` means inherit from the parent; the root defaults to true.
- **Overrides:** users can override the expired, entry and group rules through app settings ([`util/settings/Settings+autoFill.swift#L180-L195`](https://github.com/keepassium/KeePassium/blob/e651df4f89b0b8550371566ca9aa55a964d2904e/KeePassiumLib/KeePassiumLib/util/settings/Settings%2BautoFill.swift#L180-L195)).
- **KeePassium reuses KeePass's Auto-Type flags as its "AutoFill" switch.** Its entry-properties UI toggles `AutoType.Enabled` and labels it "AutoFill" ([`KeePassium/database/entry-viewer/EntryViewerCoordinator.swift#L188-L197`, `#L760-L768`](https://github.com/keepassium/KeePassium/blob/e651df4f89b0b8550371566ca9aa55a964d2904e/KeePassium/database/entry-viewer/EntryViewerCoordinator.swift#L760-L768)).
- **`BrowserHideEntry` support is limited:**
  - It is read **only on entries**, not groups, and case-insensitively ([`db/util/Bool+extension.swift#L26-L32`](https://github.com/keepassium/KeePassium/blob/e651df4f89b0b8550371566ca9aa55a964d2904e/KeePassiumLib/KeePassiumLib/db/util/Bool%2Bextension.swift#L26-L32)).
  - KeePassium writes it as `"true"`/`"false"` with a `LastModificationTime` ([`Entry2.swift#L34-L46`](https://github.com/keepassium/KeePassium/blob/e651df4f89b0b8550371566ca9aa55a964d2904e/KeePassiumLib/KeePassiumLib/db/kp2/Entry2.swift#L34-L46)).
  - The toggle ("Password AutoFill (KeePassXC)") only appears when the key already exists, so KeePassium never creates it.
  - At this revision the toggle shows the raw `BrowserHideEntry` value as "AutoFill allowed / disabled", which looks inverted ([`EntryExtraViewerVC.swift#L56-L99`](https://github.com/keepassium/KeePassium/blob/e651df4f89b0b8550371566ca9aa55a964d2904e/KeePassium/database/entry-viewer/EntryExtraViewerVC.swift#L56-L99)).
- **KeePassium ignores** Strongbox's `KPEX_DoNotSuggestForAutoFill` and Kee's `KPRPC JSON`. Neither name appears in its source.
- **Implication:** rimlock's "exclude from autofill" can be read from `AutoType/Enabled=false` and group `EnableAutoType=false`, and KeePassium users will expect those to apply. Writing them has side effects: KeePass 2.x and KeePassXC would also disable Auto-Type (see Open risks).

#### 2.3 TOTP

- **Read order:** `otp` first, then `TOTP Seed` (+`TOTP Settings`), then `TimeOtp-Secret-Base32` (+`-Length`, `-Period`, `-Algorithm`). The first field present wins, even if it fails to parse ([`db/totp/TOTPGeneratorFactory.swift#L21-L40`](https://github.com/keepassium/KeePassium/blob/e651df4f89b0b8550371566ca9aa55a964d2904e/KeePassiumLib/KeePassiumLib/db/totp/TOTPGeneratorFactory.swift#L21-L40)).
- **`otp` as otpauth** ([`#L87-L158`](https://github.com/keepassium/KeePassium/blob/e651df4f89b0b8550371566ca9aa55a964d2904e/KeePassiumLib/KeePassiumLib/db/totp/TOTPGeneratorFactory.swift#L87-L158)):
  - Requires host `totp`. HOTP is not supported.
  - Steam is detected by a path starting with `/Steam:`, by `issuer=Steam`, or by `encoder=steam`.
  - `algorithm` is matched case-insensitively against `SHA1`/`SHA256`/`SHA512` ([`db/totp/TOTPGenerator.swift#L25-L32`](https://github.com/keepassium/KeePassium/blob/e651df4f89b0b8550371566ca9aa55a964d2904e/KeePassiumLib/KeePassiumLib/db/totp/TOTPGenerator.swift#L25-L32)). An unknown value makes the whole entry show no TOTP.
- **`otp` as KeeOtp** (no scheme): honours `key`, `step`, `size`, `type` (must be `totp`) and `otpHashMode` ([`#L195-L262`](https://github.com/keepassium/KeePassium/blob/e651df4f89b0b8550371566ca9aa55a964d2904e/KeePassiumLib/KeePassiumLib/db/totp/TOTPGeneratorFactory.swift#L195-L262)).
- **`TOTP Seed`** is tried as base32, then base32hex, then base64. Settings are `period;digits` with any integer digits, or `S` for Steam ([`#L264-L322`](https://github.com/keepassium/KeePassium/blob/e651df4f89b0b8550371566ca9aa55a964d2904e/KeePassiumLib/KeePassiumLib/db/totp/TOTPGeneratorFactory.swift#L264-L322)).
- **`TimeOtp-*`:** only `-Base32` is read. `TimeOtp-Secret`, `-Hex` and `-Base64` are ignored ([`#L324-L369`](https://github.com/keepassium/KeePassium/blob/e651df4f89b0b8550371566ca9aa55a964d2904e/KeePassiumLib/KeePassiumLib/db/totp/TOTPGeneratorFactory.swift#L324-L369)).
- **Write:** KeePassium writes **only `otp`**, protected. It writes either the URI the user pasted or scanned, or a generated one ([`KeePassium/database/entry-editor/EntryFieldEditorCoordinator.swift#L207-L247`](https://github.com/keepassium/KeePassium/blob/e651df4f89b0b8550371566ca9aa55a964d2904e/KeePassium/database/entry-editor/EntryFieldEditorCoordinator.swift#L207-L247)).
  - The generated form is `otpauth://totp/<issuer>:<account>?secret=…&period=30&digits=6&algorithm=SHA1&issuer=…`, with `:` in the issuer or account replaced by `_` ([`TOTPGeneratorFactory.swift#L160-L192`](https://github.com/keepassium/KeePassium/blob/e651df4f89b0b8550371566ca9aa55a964d2904e/KeePassiumLib/KeePassiumLib/db/totp/TOTPGeneratorFactory.swift#L160-L192)).
  - It leaves any existing `TOTP Seed` or `TimeOtp-*` fields in place. Since `otp` has the highest priority in KeePassium, the stale fields only matter to other clients.

#### 2.4 Other KeePassium behaviour relevant to round-tripping

- **Unknown XML is a hard error.** KeePassium throws `unexpectedTag` for any unknown child of `Entry`, `Entry/Times`, `Group`, `Meta`, `Root` or `DeletedObjects`, so the Database fails to open ([`db/kp2/Entry2.swift#L635-L637`](https://github.com/keepassium/KeePassium/blob/e651df4f89b0b8550371566ca9aa55a964d2904e/KeePassiumLib/KeePassiumLib/db/kp2/Entry2.swift#L635-L637), [`Group2.swift#L521`](https://github.com/keepassium/KeePassium/blob/e651df4f89b0b8550371566ca9aa55a964d2904e/KeePassiumLib/KeePassiumLib/db/kp2/Group2.swift#L521), [`Meta2.swift#L543`](https://github.com/keepassium/KeePassium/blob/e651df4f89b0b8550371566ca9aa55a964d2904e/KeePassiumLib/KeePassiumLib/db/kp2/Meta2.swift#L543), [`Database2.swift#L1592`](https://github.com/keepassium/KeePassium/blob/e651df4f89b0b8550371566ca9aa55a964d2904e/KeePassiumLib/KeePassiumLib/db/kp2/Database2.swift#L1592)). This is stricter than KeePass and KeePassXC, which skip unknown elements (the #6 doc). **Rimlock must never emit XML elements outside the KDBX schema.**
- **Feature gating by format version** ([`db/kp2/DatabaseFeature2.swift#L9-L31`](https://github.com/keepassium/KeePassium/blob/e651df4f89b0b8550371566ca9aa55a964d2904e/KeePassiumLib/KeePassiumLib/db/kp2/DatabaseFeature2.swift#L9-L31)):
  - CustomData requires KDBX ≥ 4.
  - `QualityCheck`, `PreviousParentGroup`, group `Tags` and custom-icon name/time require 4.1.
  - The writer omits each of these when the file version is too low ([`Entry2.swift#L518-L535`](https://github.com/keepassium/KeePassium/blob/e651df4f89b0b8550371566ca9aa55a964d2904e/KeePassiumLib/KeePassiumLib/db/kp2/Entry2.swift#L518-L535)).
- **Tags:** written with `,`; split on `,;` and trimmed ([`db/kp2/Taggable.swift#L26-L41`](https://github.com/keepassium/KeePassium/blob/e651df4f89b0b8550371566ca9aa55a964d2904e/KeePassiumLib/KeePassiumLib/db/kp2/Taggable.swift#L26-L41)). That makes three writers using `,` (KeePassXC, KeePassDX, KeePassium) against two using `;` (KeePass 2.x, Strongbox).
- **History:** KeePassium sorts history by modification time and trims it to `HistoryMaxItems` / `HistoryMaxSize` using its own size estimate. That estimate counts field name and value bytes, custom data, attachment sizes and colours ([`Entry2.swift#L174-L241`](https://github.com/keepassium/KeePassium/blob/e651df4f89b0b8550371566ca9aa55a964d2904e/KeePassiumLib/KeePassiumLib/db/kp2/Entry2.swift#L174-L241)). This is a fourth heuristic, alongside the ones in the #6 doc.
- **Passkeys** ([`db/passkey/Passkey.swift#L72-L100`, `#L375-L418`](https://github.com/keepassium/KeePassium/blob/e651df4f89b0b8550371566ca9aa55a964d2904e/KeePassiumLib/KeePassiumLib/db/passkey/Passkey.swift#L375-L418)):
  - KeePassium uses the KeePassXC field set: `CREDENTIAL_ID` and `USER_HANDLE` as base64url and protected, `PRIVATE_KEY_PEM` protected, `RELYING_PARTY` and `USERNAME` unprotected.
  - It writes `FLAG_BE` / `FLAG_BS` as `"1"` or `"0"`. KeePassXC only ever writes `"1"`.
  - It adds **no `Passkey` tag**.
  - On read it needs all five core fields and does not accept Strongbox's legacy aliases.
  - A new passkey entry gets Title = rpId and URL = `https://` + rpId.
- **Generator name** written to Meta is `KeePassium` ([`db/kp2/Meta2.swift#L12`](https://github.com/keepassium/KeePassium/blob/e651df4f89b0b8550371566ca9aa55a964d2904e/KeePassiumLib/KeePassiumLib/db/kp2/Meta2.swift#L12)).

### 3. Kee (KeePassRPC + browser add-on)

#### 3.1 Architecture

- **Who touches the file:** the Kee add-on never touches the `.kdbx` file. KeePassRPC, a KeePass 2.x plugin, reads and writes the Database and serves entries over a WebSocket JSON-RPC.
- **Wire format:** add-on 4.1.0 offers only the v1 wire features (`KPRPC_FEATURE_VERSION_1_6`, …) and not `KPRPC_FEATURE_DTO_V2` ([KEE `src/common/FeatureFlags.ts#L1-L29`](https://github.com/kee-org/browser-addon/blob/4bd94e2d8fbcf88b7064b09efb0ae986fa4bda16/src/common/FeatureFlags.ts#L1-L29); [KRPC `KeePassRPC/KeePassRPCService.JSONRPC.cs#L985-L987`](https://github.com/kee-org/keepassrpc/blob/dc0a59b60b3ac21da9944bc5b98fe96e706af80a/KeePassRPC/KeePassRPCService.JSONRPC.cs#L985-L987)). It therefore exchanges v1 `EntryDto`s (`uRLs`, `formFieldList`, `alwaysAutoFill`, …) ([KEE `src/common/model/KPRPCDTOs.ts#L73-L125`](https://github.com/kee-org/browser-addon/blob/4bd94e2d8fbcf88b7064b09efb0ae986fa4bda16/src/common/model/KPRPCDTOs.ts#L73-L125)).
- **Storage format:** KeePassRPC still *persists* the v2 config. Both the v1 and v2 RPC save paths build an `EntryConfigv2` and call `SetKPRPCConfig(EntryConfigv2)` ([KRPC `KeePassRPCService.DTOV1.cs#L325-L355`](https://github.com/kee-org/keepassrpc/blob/dc0a59b60b3ac21da9944bc5b98fe96e706af80a/KeePassRPC/KeePassRPCService.DTOV1.cs#L325-L355), [`KeePassRPCService.DTOV2.cs#L173-L258`](https://github.com/kee-org/keepassrpc/blob/dc0a59b60b3ac21da9944bc5b98fe96e706af80a/KeePassRPC/KeePassRPCService.DTOV2.cs#L173-L258)).

#### 3.2 Where `KPRPC JSON` lives

- **Read** ([`KeePassRPC/Extensions.cs#L17-L93`](https://github.com/kee-org/keepassrpc/blob/dc0a59b60b3ac21da9944bc5b98fe96e706af80a/KeePassRPC/Extensions.cs#L17-L93)):
  - If entry CustomData has `KPRPC JSON`, it is parsed as v2.
  - Otherwise the entry *string* `KPRPC JSON` is parsed as v1 and converted to v2 in memory.
  - If neither exists, a default v1 built from the database's `DefaultMatchAccuracy` is used.
  - Invalid JSON makes KeePassRPC skip the entry and show a "configuration errors" warning.
- **Write** ([`#L127-L136`](https://github.com/kee-org/keepassrpc/blob/dc0a59b60b3ac21da9944bc5b98fe96e706af80a/KeePassRPC/Extensions.cs#L127-L136)):
  - v2 is written to CustomData, which forces KDBX 4.
  - v1 would be written to a **protected** string.
  - The KeePass entry-dialog tab writes v2 only if the config differs from the default or a v2 already exists, and then removes the v1 string ([`Forms/KeeEntryUserControl.cs#L43-L55`](https://github.com/kee-org/keepassrpc/blob/dc0a59b60b3ac21da9944bc5b98fe96e706af80a/KeePassRPC/Forms/KeeEntryUserControl.cs#L43-L55)).
  - The RPC save paths do **not** remove the v1 string, so an entry can carry a stale v1 string next to an authoritative v2 CustomData.
- **Serialization:** Jayrock with camelCased member names and enums as **name strings**. The test fixtures show exact persisted strings ([`KeePassRPCTest/EntryConfigConvert.cs#L15-L23`](https://github.com/kee-org/keepassrpc/blob/dc0a59b60b3ac21da9944bc5b98fe96e706af80a/KeePassRPCTest/EntryConfigConvert.cs#L15-L23), [`KeePassRPCTest/EntryConfigRoundtrip.cs#L14-L32`](https://github.com/kee-org/keepassrpc/blob/dc0a59b60b3ac21da9944bc5b98fe96e706af80a/KeePassRPCTest/EntryConfigRoundtrip.cs#L14-L32)):
  - v1: `"hTTPRealm"`, `"altURLs"`, `"blockedURLs"`, `"regExURLs"`, `"regExBlockedURLs"`.
  - v2: `"httpRealm"`, `"altUrls"`, …. Null members are omitted.

#### 3.3 `KPRPC JSON` v2 schema

From [`Models/Persistent/EntryConfigv2.cs#L6-L17`](https://github.com/kee-org/keepassrpc/blob/dc0a59b60b3ac21da9944bc5b98fe96e706af80a/KeePassRPC/Models/Persistent/EntryConfigv2.cs#L6-L17) and [`Models/Shared/*.cs`](https://github.com/kee-org/keepassrpc/tree/dc0a59b60b3ac21da9944bc5b98fe96e706af80a/KeePassRPC/Models/Shared):

```text
EntryConfigv2 {
  version: 2
  altUrls?: string[]            // extra URLs, matched like URL
  blockedUrls?: string[]        // block if blockedUrl.Contains(pageUrl)
  regExUrls?: string[]          // .NET regex; a match = MatchAccuracy.Best
  regExBlockedUrls?: string[]   // .NET regex; a match blocks
  httpRealm?: string
  authenticationMethods?: string[]   // e.g. "password" (comment also lists "facebook", "passkey")
  behaviour?: "Default" | "NeverAutoFillNeverAutoSubmit" | "NeverAutoSubmit"
            | "AlwaysAutoFillAlwaysAutoSubmit" | "AlwaysAutoFill" | "AlwaysAutoFillNeverAutoSubmit"
  matcherConfigs: EntryMatcherConfig[]   // must contain one {matcherType:"Url"}
  fields?: Field[]
}
EntryMatcherConfig {
  matcherType?: "Custom" | "Hide" | "Url"
  customMatcher?: { matchLogic?: "Client"|"All"|"Any", queries?: string[], pageTitles?: string[] }
  urlMatchMethod?: "Domain" | "Hostname" | "Exact"    // null means Domain
  weight?: int
  actionOnMatch?, actionOnNoMatch?: "TotalMatch" | "TotalBlock" | "WeightedMatch" | "WeightedBlock"
}
Field {
  uuid: string            // base64 of 16 bytes
  name?: string           // display name
  valuePath: "UserName" | "Password" | "."   // "." = value stored in `value`
  value?: string
  page: int (>=1)
  type: "Text" | "Password" | "Existing" | "Toggle" | "Otp" | "SomeChars"
  placeholderHandling?: "Default" | "Enabled" | "Disabled"
  matcherConfigs?: FieldMatcherConfig[]
}
FieldMatcherConfig {
  matcherType?: "Custom" | "UsernameDefaultHeuristic" | "PasswordDefaultHeuristic"
  customMatcher?: { matchLogic?, ids?, names?, types?, queries?, labels?, autocompleteValues?, maxLength?, minLength? }
  weight?: int, actionOnMatch?: MatchAction
}
```

The v1 to v2 mapping is in [`Models/Persistent/EntryConfigv1.cs#L154-L189`](https://github.com/kee-org/keepassrpc/blob/dc0a59b60b3ac21da9944bc5b98fe96e706af80a/KeePassRPC/Models/Persistent/EntryConfigv1.cs#L154-L189):

- **Flags:** `neverAutoFill` → `NeverAutoFillNeverAutoSubmit`, and so on; `hide:true` → an extra `{matcherType:"Hide"}`.
- **Match accuracy:** `blockHostnameOnlyMatch` → `urlMatchMethod:"Exact"`, and `blockDomainOnlyMatch` → `"Hostname"`.
- **Form fields:** `{USERNAME}` / `{PASSWORD}` form fields → `valuePath` `UserName` / `Password`.

#### 3.4 How KeePassRPC matches

From [`KeePassRPCService.JSONRPC.cs#L1290-L1395`](https://github.com/kee-org/keepassrpc/blob/dc0a59b60b3ac21da9944bc5b98fe96e706af80a/KeePassRPC/KeePassRPCService.JSONRPC.cs#L1290-L1395) and [`KeePassRPCService.cs#L333-L409`](https://github.com/kee-org/keepassrpc/blob/dc0a59b60b3ac21da9944bc5b98fe96e706af80a/KeePassRPC/KeePassRPCService.cs#L333-L409):

- **Search scope:** only entries under the Kee **home group** are searched. That group is `RootUUID` in `KeePassRPC.Config`, or a per-location group from KeePass's own config ([`KeePassRPCService.cs#L465-L500`](https://github.com/kee-org/keepassrpc/blob/dc0a59b60b3ac21da9944bc5b98fe96e706af80a/KeePassRPC/KeePassRPCService.cs#L465-L500)).
- **Skipped entries:** entries in the recycle bin and entries with a `Hide` matcher.
- **Candidate URLs:** `URL` plus `altUrls`. `KP2A_URL*`, `URL_n` and `OverrideURL` are **not** read.
- **Ranking:**
  - Best: regex hit or an identical URL.
  - Close: the same URL without the query string.
  - HostnameAndPort.
  - HostnameExcludingPort.
  - Domain (registrable domain via the public suffix list).
- **Accuracy limit:** `urlMatchMethod` caps how loose a match may be. The database `matchedURLAccuracyOverrides[registrableDomain]` overrides it per site.
- **Blocking:** checked after matching.
- **Placeholders:** Kee field placeholders are off by default (`defaultPlaceholderHandling:"Disabled"`).

#### 3.5 Database-level config

- **Meta CustomData `KeePassRPC.Config`** is JSON of `DatabaseConfig` with these members ([`DatabaseConfig.cs#L6-L20`](https://github.com/kee-org/keepassrpc/blob/dc0a59b60b3ac21da9944bc5b98fe96e706af80a/KeePassRPC/DatabaseConfig.cs#L6-L20)):
  - `version` = 3.
  - `rootUUID`: 32-char hex.
  - `defaultMatchAccuracy` = `Domain`.
  - `matchedURLAccuracyOverrides`: an object mapping domain → method.
  - `defaultPlaceholderHandling` = `Disabled`.
- **When KeePassRPC writes it:**
  - It sets the key (in memory) whenever it is missing, and writes it on DB creation ([`Extensions.cs#L148-L181`](https://github.com/kee-org/keepassrpc/blob/dc0a59b60b3ac21da9944bc5b98fe96e706af80a/KeePassRPC/Extensions.cs#L148-L181), [`KeePassRPCExt.cs#L768-L775`](https://github.com/kee-org/keepassrpc/blob/dc0a59b60b3ac21da9944bc5b98fe96e706af80a/KeePassRPC/KeePassRPCExt.cs#L768-L775)).
  - It removes `KeePassRPC.KeeFox.configVersion` on open ([`KeePassRPCExt.cs#L789-L819`](https://github.com/kee-org/keepassrpc/blob/dc0a59b60b3ac21da9944bc5b98fe96e706af80a/KeePassRPC/KeePassRPCExt.cs#L789-L819)).
- **Version gate:** a database whose config `version` is not 3 is excluded from Kee searches ([`KeePassRPCService.cs#L450-L458`](https://github.com/kee-org/keepassrpc/blob/dc0a59b60b3ac21da9944bc5b98fe96e706af80a/KeePassRPC/KeePassRPCService.cs#L450-L458)).
- **Icons:** Kee also stores site favicons as Meta custom icons when it saves entries ([`KeePassRPCService.DTOV2.cs#L243-L254`](https://github.com/kee-org/keepassrpc/blob/dc0a59b60b3ac21da9944bc5b98fe96e706af80a/KeePassRPC/KeePassRPCService.DTOV2.cs#L243-L254)).

#### 3.6 TOTP and passkeys in Kee

- KeePassRPC has no TOTP storage or generation code. `FieldType.Otp` exists in the schema, and a comment in the add-on says OTP transfer is undecided ([KEE `src/common/model/Field.ts#L5-L20`](https://github.com/kee-org/browser-addon/blob/4bd94e2d8fbcf88b7064b09efb0ae986fa4bda16/src/common/model/Field.ts#L5-L20)).
- Kee has no passkey support. `"passkey"` appears only in an `authenticationMethods` comment.

### 4. Implications for rimlock

- **Additional URLs, read:** read `URL`, `KP2A_URL*`, `URL_n`, `OverrideURL` (KeePassium treats it as a URL), and `KPRPC JSON` `altUrls`, from v2 CustomData first and the v1 string otherwise.
- **Additional URLs, write:** keep the #6 recommendation of `KP2A_URL`, `KP2A_URL_1`, …. KeePassium writes exactly this, and KP2A reads it through text search. Do not mirror URLs into `KPRPC JSON` unless Kee interop is chosen explicitly (see Open risks).
- **Android app IDs:** read both `AndroidApp_n` (bare package) and `AndroidAppN` (`androidapp://pkg`). Rimlock, as a browser extension, should never write them.
- **Autofill exclusion signals to *read*:**
  - `BrowserHideEntry` on the entry and the resolved group value.
  - `KPEX_DoNotSuggestForAutoFill`.
  - `KPRPC JSON` Hide matcher or `neverAutoFill` behaviour.
  - Entry `AutoType/Enabled=false` and group `EnableAutoType=false`, which KeePassium treats as an AutoFill opt-out.
  - Group `EnableSearching=false`.
  - Entries in a group named `AutoOpen`.
- **Which exclusion signal to write:** this is a product decision. It belongs in an ADR, not here.
- **TOTP:** the #6 recommendation to dual-write `otp` + `TimeOtp-Secret-Base32` works for KP2A and KeePassium as well. Two extra rules:
  - Write `algorithm` as exactly `SHA256`/`SHA512`, or omit it for SHA-1, so KP2A computes correct codes.
  - Don't rely on `TimeOtp-Secret`, `-Hex` or `-Base64` alone, because KeePassium only reads `-Base32`.
- **XML:** never emit non-schema XML. KeePassium refuses to open such a file.

## Open risks / unknowns

1. **Stale TOTP representations get worse with more clients.** KeePassium and KP2A both read `otp` (KP2A only after the legacy pair). KeePassium writes only `otp` and leaves `TimeOtp-*` and `TOTP Seed` untouched. After an edit in KeePassium, KeePassXC still prefers the legacy pair and KP2A the TrayTotp pair, so they show the *old* code. The #6 rule "rewrite every representation already present" stays necessary but cannot protect against other clients' edits.
2. **KP2A's otpauth algorithm parsing is case-sensitive and silent.** Any `algorithm=sha256` or `HMAC-SHA-256` value written by another tool yields wrong SHA-1 codes in KP2A without a warning.
3. **Reusing `AutoType/Enabled` as an autofill opt-out is a semantic collision.** It disables Auto-Type in KeePass 2.x / KeePassXC as well. Should rimlock honour it for exclusion (KeePassium parity) while never writing it? That needs a decision.
4. **Kee interop scope.** Writing `KPRPC JSON` means maintaining a Jayrock-compatible JSON schema with .NET-regex `regExUrls`. JavaScript regex semantics differ, for example in lookbehind and named-group syntax. Reading only `altUrls` / `blockedUrls` / Hide / `behaviour` is cheap. Does rimlock read `regExUrls`, and if so with which regex engine? Also unresolved: whether Kee's `blockedUrls` semantics (`blocked.Contains(pageUrl)`, i.e. the stored string contains the page URL) are worth reproducing.
5. **Stale v1 `KPRPC JSON` strings.** Entries saved through the RPC path keep an outdated protected v1 string next to the v2 CustomData. If rimlock edits Kee config, it must update v2 and must not "fix" or remove v1 unless it removes both consistently.
6. **`KeePassRPC.Config` member names are inferred, not observed.** No test fixture shows the persisted `DatabaseConfig` JSON. The camelCase names above assume the same Jayrock behaviour seen in the entry-config fixtures.
7. **Kee Vault was not inspected.** The add-on also talks to Kee Vault, a browser-hosted KeeWeb fork (`KPRPC_FEATURE_BROWSER_HOSTED`), which may read and write `KPRPC JSON` with its own (TypeScript) serializer and different key casing. Its repository was out of scope.
8. **KeePassium's `BrowserHideEntry` UI appears inverted** at `e651df4f`. Users may have toggled the flag with the opposite meaning, so the stored value cannot be fully trusted as user intent.
9. **KP2A full-text fallback over-matches.** Any entry mentioning the domain in Notes or any field is offered. KP2A users may rely on this ("it works on my phone"), so rimlock's stricter URL matching could look like a regression to them.
10. **KeePassium's latest public commit is older than its releases.** CHANGELOG head 2.6.173 is dated 2025-05-23 while the commit is 2026-05-23. Released builds may differ from the pinned source.
