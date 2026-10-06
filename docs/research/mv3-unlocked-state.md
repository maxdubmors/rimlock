# MV3 background execution and unlocked-state lifetime

Research for issue #3. Researched 2026-10-06. Feeds the architecture decision in #12; this note does not make that decision.

Source dates: Chrome docs pages carry a "Last updated" date, given in brackets. MDN pages carry a "last modified" date. Source code is cited at the commit that was `HEAD` of the default branch on 2026-10-06 (SHAs listed in [Sources](#sources)).

## Question

Where can an unlocked Database (decrypted model plus key material) live inside an MV3 Extension, and for how long, in Chrome and Firefox? What would Safari change?

1. Chrome service worker lifetime and termination rules; offscreen documents (allowed reasons, lifetime); `chrome.storage.session` (memory-only? size limits, access levels).
2. Firefox MV3 event pages / background scripts: persistence, termination, `storage.session` support.
3. Running WASM in each of these contexts; cost of re-initialising after the worker is killed.
4. What popup, side panel and content scripts can reach, and over which messaging channels.
5. Safari Web Extension equivalents and limits.

## Summary

No MV3 background context on any of the three browsers is persistent. The background can be torn down after about 30 s without events or API calls, and every in-memory JS/WASM object goes with it. Three places survive that teardown:

- `storage.session`. It is held in memory by the browser (outside the extension's JS heap), survives background restarts, and is wiped on browser restart and on extension reload, update or disable.
- A Chrome offscreen document. Chromium sets no lifetime limit for any reason except `AUDIO_PLAYBACK`, but the document can only call `chrome.runtime` (messaging).
- An open extension page (popup, side panel or sidebar, tab). It lives only as long as the user keeps it open.

Keeping the background alive on purpose is possible in Chrome and Firefox (a trivial API call every <30 s, or an open native-messaging port). Chrome's documentation says indefinite keep-alive is "not allowed" outside managed enterprise/education devices. A native-messaging port, such as one to a future Companion, is an explicitly sanctioned exemption in both Chrome and Firefox.

### Constraints by browser and context

| | Chrome (MV3) | Firefox (MV3) | Safari (MV3) |
|---|---|---|---|
| Background type | Service worker only; no DOM, no `Worker`, no dynamic `import()` | Event page (DOM document, `background.scripts`). `background.service_worker` not supported (pref locked off) | Non-persistent background page or service worker (both supported) |
| Idle termination | 30 s without events or extension API calls. Also: a single event/API call >5 min; a `fetch()` response >30 s | 30 s idle (`extensions.background.idle.timeout`, clamped 100 ms to 5 min) | 30 s unload timer; postponed while ports had activity in the last 2 min, permission prompts are pending, or Web Inspector is attached (WebKit source) |
| What resets or extends | Any event or extension API call (Chrome 110+); offscreen messages (109+); port messages (114+, merely opening a port no longer counts); WebSocket traffic (116+); `connectNative` port (105+); debugger session (118+) | Events dispatched to the background; background API calls into the parent process; open native-messaging port; pending listener promises; active `StreamFilter`s. Message ports do not keep it alive (MDN) | Recently active open ports; pending permission requests; inspector |
| Persistent background allowed? | No (MV2 is gone: disabled in Chrome 138, removed from the CWS 2026-08-31) | Not in MV3. MV2 persistent background pages still work, and Mozilla has "no plans to deprecate MV2" (March 2024) | Not in MV3. Not on iOS/iPadOS/visionOS in any version. macOS MV2 may be persistent |
| `storage.session` | Chrome 102+. 10 MB (1 MB up to Chrome 111). Browser-process memory. JSON-serialisable values. Hidden from content scripts unless `setAccessLevel` opens it | Firefox 115+. 10 MB, enforced. Parent-process memory, structured clone. Not exposed to content scripts; `setAccessLevel` not supported | Safari 16.4+. 10 MB. In-memory SQLite in the UI process. `setAccessLevel` supported |
| Long-lived DOM context | Offscreen document (Chrome 109+): one per profile, `runtime` API only, unlimited lifetime except `AUDIO_PLAYBACK` | No offscreen API needed: the event page itself is a DOM document | Offscreen API is being implemented in WebKit `main` (Aug 2026, "testable mode"); not documented as shipped in Safari |
| Persistent UI surfaces | Popup (closes on blur); side panel (Chrome 114+, full API, stays open across tabs) | Popup; `sidebar_action` (full extension page) | Popup. No `sidePanel` or `sidebar_action` (WebKit sidebar code compiled off) |
| WASM | Needs `'wasm-unsafe-eval'` in `extension_pages` CSP (allowed in the MV3 minimum policy) | Same; `'wasm-unsafe-eval'` required in MV3 | Same (CSP keyword supported since Safari 16) |
| Messaging serialisation | JSON (64 MiB max per message) | Structured clone | Not documented by Apple (see Open risks) |

## Findings

### 1. Chrome: service worker, offscreen documents, `storage.session`

**Service worker termination.** Chrome terminates an extension service worker "after 30 seconds of inactivity. Receiving an event or calling an extension API resets this timer", or when "a single request, such as an event or API call, takes longer than 5 minutes", or when "a `fetch()` response takes more than 30 seconds to arrive" [C1, 2023-05-02]. Version history from the same page:

- 105: an open `runtime.connectNative()` port keeps the worker alive. If the host dies, the port closes and the timers resume.
- 109: messages from an offscreen document reset the timers.
- 110: extension API calls reset the timers.
- 114: sending a message on a long-lived port keeps the worker alive; "Opening a port no longer resets the timers."
- 116: WebSocket traffic resets the idle timer; user-prompt APIs may run past 5 minutes.
- 118: an attached `chrome.debugger` session keeps it alive.
- 120: alarms can fire every 30 s.

The lifecycle page also says global variables "will be lost if the service worker shuts down" and that `setTimeout`/`setInterval` timers are cancelled on termination, so `chrome.alarms` should be used instead [C1, C2].

**Keep-alive policy.** For long operations, Chrome documents a `waitUntil` helper that calls `chrome.runtime.getPlatformInfo` every 25 s, "reserved for exceptional cases" [C2, 2023-03-09]. For continuous keep-alive the same page says: "we specifically allow this [for enterprise and education] ... It is not allowed in other cases and the Chrome extension team reserves the right to take action against those extensions in the future" [C2]. A consumer password-manager Extension therefore cannot rely on a heartbeat to hold an unlocked Database in the worker.

**Service worker restrictions relevant to the KDBX core.** There is no DOM. The Web Storage API is unavailable [C1]. Dynamic `import()` is not supported; only static `import` (with `"type": "module"`) or `importScripts()` [C3, 2023-05-02]. The worker cannot spawn Web Workers, which is why the offscreen API has a `WORKERS` reason [C4].

**Offscreen documents** (Chrome 109+, MV3, `offscreen` permission) [C4, 2026-09-21]:

- Reasons: `TESTING`, `AUDIO_PLAYBACK`, `IFRAME_SCRIPTING`, `DOM_SCRAPING`, `BLOBS`, `DOM_PARSER`, `USER_MEDIA`, `DISPLAY_MEDIA`, `WEB_RTC`, `CLIPBOARD`, `LOCAL_STORAGE`, `WORKERS`, `BATTERY_STATUS`, `MATCH_MEDIA`, `GEOLOCATION`. `createDocument()` also takes a free-text `justification`.
- "The runtime API is the only extensions API supported by offscreen documents." The document cannot read `chrome.storage` (session or local) itself and must get data via `runtime` messaging from the worker or another extension page.
- An installed extension can have only one open offscreen document at a time (one per profile in split-incognito mode). It must be a bundled static HTML file. It cannot be focused.
- Lifetime: "The `AUDIO_PLAYBACK` reason sets the document to close after 30 seconds without audio playing. All other reasons don't set lifetime limits." The Chromium source matches: `lifetime_enforcer_factories.cc` maps every reason except `kAudioPlayback` to an `EmptyLifetimeEnforcer` whose `IsActive()` always returns true. A comment notes these reasons "do not currently have bespoke lifetime enforcement. This enforcement can be added on as-appropriate basis" [C6].
- Intent: the launch post (2023-01-25) says the document "will have a lifetime mechanism similar to event pages ... torn down when it stops performing actions". It also says only runtime messaging is exposed "to reduce the likelihood of extensions using these as a 'background page replacement'", and that the offscreen document "should not be the place to store primary extension logic" [C5]. In Dec 2022 a Chrome DevRel engineer said the justification string may be shown to users "if it detects that the offscreen document has been alive for an unusually long time" and that lifetime interventions were "still in flux" [C16]. As of 2026-10 no such intervention exists in source [C6].
- The offscreen document's lifetime is independent of the worker that created it [C5]. Messages it sends reset the worker's idle timer (Chrome 109+) [C1].

**`chrome.storage.session`** [C7, 2026-09-11]:

- "Items in the `session` storage area are stored in-memory and will not be persisted to disk." The store is a `KeyedService` (`SessionStorageManager`) attached to the `BrowserContext`, i.e. it lives in the browser process, not in the extension renderer [C8]. Data there survives service-worker termination.
- Cleared when "the extension is disabled, reloaded, updated, and when the browser restarts." An auto-update of the Extension therefore wipes it.
- Quota: 10 MB (`QUOTA_BYTES = 10485760`; 1 MB in Chrome 111 and earlier), "measured by estimating the dynamically allocated memory usage of every value and key". Over-quota writes fail.
- "By default, it's not exposed to content scripts, but this behavior can be changed by calling `storage.session.setAccessLevel()`". Levels are `TRUSTED_CONTEXTS` and `TRUSTED_AND_UNTRUSTED_CONTEXTS`.
- Values must be JSON-serialisable [C7]. Binary key material has to be encoded (e.g. base64 or number arrays), and a WebCrypto `CryptoKey` cannot be stored.
- The docs recommend `storage.session` over `storage.sync` "if you're working with sensitive user data" [C7].

### 2. Firefox: event pages and `storage.session`

**No background service worker.** `background.service_worker` "is not supported" in Firefox [F1, 2026-09-05]. The pref `extensions.backgroundServiceWorker.enabled` is `false, locked` in release builds [F12], and the meta bug 1573659 is still NEW (last changed 2026-08-12) [F11]. A manifest can list both `scripts` and `service_worker`: Chrome uses the worker and Firefox the event page (fixed in Firefox 121, bug 1860304) [F1, F11]. Firefox 136+ also understands `preferred_environment` [F10].

**MV3 background is always non-persistent.** "In Manifest V3, only non-persistent background scripts or a page are supported" [F2, 2026-07-27]. The event page is a real DOM document (it can use the DOM, `Worker`, etc.).

**Termination rules (from source, `ext-backgroundPage.js`)** [F3]:

- Idle timeout pref `extensions.background.idle.timeout`, default `30000` ms, clamped to 100 ms to 5 min.
- The timer is reset by every event dispatched to a background listener (`reason: "event"`, `ExtensionCommon.sys.mjs`) [F5] and by every API call from the background context that goes to the parent process (`reason: "parentapicall"`, `ExtensionParent.sys.mjs`) [F4]. The "periodic trivial API call" keep-alive therefore also works in Firefox. No Mozilla policy text on keep-alive was found (see Open risks).
- At timeout, termination is skipped while there is an active native-messaging port or a pending `sendNativeMessage`. The source comment: "Similar to what happens in recent Chrome version for MV3 extensions ... with a nativeMessaging port still open ... are exempt from being terminated when the idle timeout expires." It is also skipped for pending listener promises (reset once) and active `webRequest` `StreamFilter`s [F3].
- "Message ports cannot prevent an event page from shutting down ... the ports are closed when the event page idles" [F2]. An open popup or sidebar does not keep the event page alive just by being open. `terminateBackground()` does not check for open views [F3].
- `runtime.onSuspend` fires before unload (Firefox 106+) [F2, F10]. MDN says data should be persisted periodically rather than in `onSuspend`, because a crash skips it [F2].
- Crash behaviour: "non-persistent background scripts ... running at the time of the crash are not reloaded" until an event arrives [F2].

**`storage.session`** [F6, 2026-10-04; F7]:

- Firefox 115+ (`QUOTA_BYTES`/`getBytesInUse` 131+, `getKeys` 143+) [F10]. Kept in memory "only until the either browser or extension is closed or reloaded" (schema description) [F7].
- Stored in the parent process (`ExtensionStorage.sys.mjs`) as `StructuredCloneHolder`s, so typed arrays work without encoding [F7].
- Quota 10 MB. Enforcement is behind `webextensions.storage.session.enforceQuota`, which is `true` in `all.js` on `main` [F7].
- Not exposed to content scripts. The `ext-storage.js` comment: "Session storage is not exposed to content scripts" [F7]. `setAccessLevel` is not implemented in Firefox (BCD `version_added: false`) [F10], although MDN's prose says otherwise [F6]. Treat it as unavailable.
- Caveat: `moz-extension:` pages loaded in an iframe inside a web page get content-script privileges in Firefox (bug 1443253, REOPENED, last changed 2026-07-09) [F11]. Such an iframe (e.g. an inline autofill dropdown) cannot reach `storage.session` and has to message the background. Proton Pass works around this in source [P1].

**MV2 is still an option on Firefox.** "Firefox, however, has no plans to deprecate MV2 and will continue to support MV2 extensions for the foreseeable future" [F13, March 2024; no newer statement found]. In MV2, `persistent: true` background pages still work [F10]. Bitwarden and KeePassXC-Browser both ship MV2 persistent backgrounds on Firefox today (see prior art).

### 3. WASM in each context; re-initialisation cost

**CSP.** All three browsers require `'wasm-unsafe-eval'` in the `extension_pages` CSP for WebAssembly in MV3. Without it "WebAssembly will be disabled" in Chrome [C10, 2024-02-13]. Chrome's minimum (most permissive allowed) policy is `script-src 'self' 'wasm-unsafe-eval'; object-src 'self';` [C10]. MDN documents the same for Firefox MV3 [F9]. The keyword is supported in Chrome 97+, Firefox 102+ and Safari 16+ [F10]. The extension-pages policy applies to the "popup, background worker, and tabs with HTML pages or iframes that were opened by the extension" [C10]. The offscreen document is an extension page, so it gets the same policy.

**Contexts that can run WASM:**

- Chrome service worker: yes. Bitwarden ships its Rust-to-WASM SDK (`@bitwarden/sdk-internal`) in its MV3 service worker [B1]. The module must be reached via a static import or `importScripts` (no dynamic `import()`) [C3].
- Chrome offscreen document: yes (extension page). It is also the only Chrome background-ish context that can spawn Web Workers (`WORKERS` reason) [C4].
- Firefox event page, popup, side panel or sidebar, Safari background: yes (extension pages or worker with the same CSP).
- Content scripts: technically possible, but they are the wrong place for key material. Chrome: "Content scripts are less trustworthy than the extension service worker ... a malicious web page might be able to compromise the rendering process that runs the content scripts" [C9, 2025-12-03].

**What re-initialising costs.** When the background dies, the WASM instance, its linear memory and any decrypted model are gone. Rebuilding an unlocked Database costs:

1. WASM compile and instantiate (size-dependent). Bitwarden logs this as "WASM SDK loaded in N ms" [B1]. No vendor numbers were found, so measure it.
2. Getting key material back. With keepass-rs as-is, the only public open path is `Database::open/parse(data, DatabaseKey)` [K1]. `parse.rs` always recomputes `composite_key → kdf.transform_key() → master_key`, and there is no public API to open with a cached transformed key [K1]. Every reopen re-runs the KDF.
3. The KDF itself. KeePassXC's defaults for new KDBX4 databases are Argon2 with 64 MiB memory (`1 << 16` KiB), 10 rounds and 4 lanes, with a benchmark that targets 1000 ms of KDF time on the creating machine [K2]. keepass-rs forces `ThreadMode::Sequential` on `wasm32` [K1], so in WASM all lanes run on one thread. Expect it to be slower than the desktop target, though no measurements are available here. Argon2 also needs that 64 MiB inside WASM linear memory.
4. Decrypting and parsing the payload (ChaCha20/AES, gzip, XML), proportional to Database size.
5. Saving also runs the KDF. `dump.rs` draws a fresh `kdf_seed` and `master_seed` with `getrandom` on every save and re-derives the key [K1]. Any context that writes the Database back needs the composite key (or password-equivalent material) and pays the KDF cost again.

The re-unlock path after an unexpected teardown therefore needs one of: (a) the user re-enters the master password, (b) password-equivalent key material kept somewhere that survives (e.g. `storage.session`), or (c) a context that does not get torn down. That choice belongs to #12.

**Parallelism.** Multi-threaded WASM needs `SharedArrayBuffer`, which needs cross-origin isolation. Chrome extensions can opt in via the `cross_origin_embedder_policy` / `cross_origin_opener_policy` manifest keys [C14, 2021-08-03]. Whether this works for an offscreen document plus workers running wasm-threads Argon2 was not verified (see Open risks).

### 4. What popup, side panel and content scripts can reach

- **Popup** (all browsers): a full extension page with full API access. It "automatically close[s] when the user focuses on some portion of the browser outside of the popup. There is no way to keep the popup open" [C13, 2023-12-12]. Anything held only in popup memory is lost on every close.
- **Chrome side panel** (Chrome 114+): "As an extension page, side panels have access to all Chrome APIs", and it is designed for "persistent experiences" [C12, 2026-09-11]. It stays open while the user keeps it open (global or per-tab). `sidePanel.open()` requires a user gesture (Chrome 116+) [C12]. Not available in Firefox or Safari [F10].
- **Firefox sidebar** (`sidebar_action`, Firefox 54+): a full extension page; not in Chrome or Safari [F10].
- **Direct object access to the background.** `runtime.getBackgroundPage()` returns the background `Window` in Firefox and Safari (event or background page), so a Firefox popup could reach background JS objects directly. It returns `null` from private-window views [F10]. Chrome's MV3 service worker has no `Window`, so popup and worker share nothing except messaging and storage.
- **Content scripts** (Chrome) can directly use `i18n`, `storage`, and `runtime.connect/sendMessage/onMessage/onConnect/getURL/getManifest/id`. "Content scripts are unable to access other APIs directly" [C11]. They cannot read `storage.session` by default in Chrome or Safari, and never in Firefox [C7, F7, F10].
- **Channels:**
  - One-shot: `runtime.sendMessage` / `tabs.sendMessage`.
  - Long-lived: `runtime.connect` / `tabs.connect` ports.
  - External: `onMessageExternal` / `onConnectExternal`, gated by `externally_connectable`.
  - Native: `runtime.connectNative` / `sendNativeMessage`.
  - All from [C9].
- Serialisation: "In Chrome, the message passing APIs use JSON serialization ... different to other browsers which implement the same APIs with the structured clone algorithm". Max message size is 64 MiB [C9]. Firefox uses structured clone [F8].
- `runtime.getContexts()` (Chrome 116+, Firefox 127+, not Safari) lets the background discover open popups, side panels and the offscreen document [F10].
- **Firefox extension iframes in web pages** have content-script privileges only (bug 1443253) [F11].

### 5. Safari Web Extensions

- **Background must be non-persistent in MV3**, and on iOS always. Apple: "In iOS, you must make your background page nonpersistent ... Your background page must be nonpersistent or you must declare your background script as a service worker if you're using manifest version 3" [S1]. In WebKit, `persistent: true` with MV3 is a manifest error ("A `manifest_version` greater-than or equal to `3` must be non-persistent") [S5]. On iOS/visionOS a persistent background refuses to load ("Cannot load persistent background content on this platform") [S4].
- **Both background environments are supported**: a non-persistent page (DOM) or a service worker. `preferred_environment` (Safari 18+) picks between them [F1, F10, S8]. WWDC26 (Safari 27): "Safari supports both, so it's really your preference" [S8].
- **Unload timing** (WebKit `WebExtensionContext`, used by `WKWebExtension`) [S4]:
  - The background unloads 30 s after `scheduleBackgroundContentToUnload()`.
  - It is postponed while the page has open ports with activity in the last 2 minutes, while permission requests are pending, or while Web Inspector is attached.
  - Apple's doc adds that Safari "unloads your nonpersistent background page when the user isn't directly interacting with the extension" and decides "when to keep it in memory or unload it based on system memory usage" [S1].
- **`storage.session`** (Safari 16.4+): Apple calls it "particularly useful for storing sensitive or security-related data, such as decryption keys or authentication tokens ... not persisted to disk and it's cleared when Safari quits" [S2]. In WebKit it is an in-memory SQLite store in the UI process with a 10 MiB quota (`webExtensionStorageAreaSessionQuotaBytes`) [S6]. `setAccessLevel` is supported (16.4+) [F10].
- **Offscreen**: WebKit landed the start of `browser.offscreen` on 2026-08-08: "This PR doesn't actually implement the API functionality ... once it is compiled on, will be in testable mode to start" [S7]. `ENABLE_WK_WEB_EXTENSIONS_OFFSCREEN` now defaults on in `PlatformEnableCocoa.h`, but nothing documents a shipping Safari version.
- **No side panel or sidebar** API: `ENABLE_WK_WEB_EXTENSIONS_SIDEBAR` is `0` [S7]. BCD shows neither `sidePanel` nor `sidebar_action` in Safari [F10].
- `runtime.getContexts` and `runtime.onSuspend` are not implemented (webkit.org/b/294456, /b/294458) [F10].
- **Native messaging** goes to the containing app's extension handler (`SafariWebExtensionHandler`), not an arbitrary host binary [S8]. This matters for a future Companion on macOS/iOS.

## How prior-art extensions do it

### Bitwarden (`bitwarden/clients`, `apps/browser`)

- **Manifest split.** Chrome, Edge and Opera ship MV3 (`service_worker`, `minimum_chrome_version: 134.0`). Firefox and Safari production builds are **MV2 with `"persistent": true`**: `webpack.base.js` defaults `manifestVersion` to 2 unless `MANIFEST_VERSION=3`, and the CI artifact for Firefox MV3 is named `DO-NOT-USE-FOR-PROD-dist-firefox-MV3` [B1].
- **MV3 state storage.** "mv3 stores to `storage.session`" (`BrowserMemoryStorageService` wraps `chrome.storage.session`). MV2 stores it in background memory [B1].
- **Large objects** go to `LocalBackedSessionStorageService`. A random ephemeral key is kept in `storage.session`. The values are encrypted with it and written to `storage.local`, then decrypted into an in-memory cache. "When the session key is unavailable, any encrypted items in local storage cannot be decrypted and must be cleared" [B1]. This works around the `storage.session` quota and still makes browser restart act as a lock.
- **Offscreen document.** Used for clipboard and `localStorage` access via `OffscreenDocumentService`, not as a state holder [B1].
- **WASM.** Rust SDK compiled to WASM runs in the MV3 service worker. CSP is `script-src 'self' 'wasm-unsafe-eval'` [B1].

### KeePassXC-Browser (`keepassxreboot/keepassxc-browser`)

- Chrome uses MV3 with a service worker (`minimum_chrome_version: 124`). Firefox uses MV2 with background scripts (persistent by default in MV2) [X1].
- It never holds a Database. All secrets live in the KeePassXC desktop app, reached via `browser.runtime.connectNative(...)` [X1]. The open native port is what keeps Chrome's worker (105+) and Firefox's event page alive [C1, F3].
- Its offscreen document has reason `MATCH_MEDIA` (detecting the colour scheme) [X1].

This is the closest model for a future rimlock Companion mode.

### Proton Pass (`ProtonMail/WebClients`, `applications/pass-extension`)

- MV3 on all three: a Chrome service worker (`minimum_chrome_version: 102`), Firefox `background.scripts` (`strict_min_version: 109.0`), and a Safari service worker. All declare `'wasm-unsafe-eval'` and ship `*.wasm` [P1].
- The decrypted auth session, including `keyPassword`, `offlineKD`, tokens and lock state (`SESSION_KEYS`), is written to `storage.session`. It is read back as the "memory session" when the service worker wakes ("Handle service-worker wake-up with a valid offline memory session") [P1].
- Locking removes these keys from `storage.session`. Lock TTL is driven by `alarms` [P1].
- Falls back to an in-memory store, proxied to the background by messaging, where `storage.session` is undefined (Firefox extension iframes, bug 1443253) [P1].
- Offscreen document: `reasons: ['CLIPBOARD']`, "being able to clear clipboard after a delay" [P1].

### Pattern across the three

No surveyed extension keeps its unlocked state alive with a heartbeat or a long-lived offscreen document. The MV3 builds rebuild state from `storage.session` (key material) on each worker wake-up, with the browser restart or extension update acting as an implicit lock. Bitwarden and KeePassXC-Browser avoid the problem on Firefox by staying on MV2 persistent background pages. KeePassXC-Browser avoids it on every browser by keeping secrets in a native app.

## Open risks / unknowns

1. **Re-unlock latency in a WASM worker.** No benchmarks for keepass-rs Argon2 (64 MiB, sequential) or WASM instantiate time inside a Chrome extension service worker. Measure this before #12 picks a design that re-runs the KDF on every worker wake-up.
2. **keepass-rs API gap.** Opening from a cached transformed key, or saving without a fresh KDF run, is not supported. Supporting it means a fork or an upstream change, and caching a transformed key is password-equivalent for the current file version.
3. **Is password-equivalent key material in `storage.session` acceptable?** It sits in browser-process heap (Chrome), parent-process heap (Firefox) or UI-process SQLite-in-memory (Safari). None of the vendor docs say anything about swap, crash dumps or hibernation for this memory. Bitwarden and Proton do it anyway, and Apple recommends it for "decryption keys".
4. **Offscreen document as a long-lived holder.** It works today (no lifetime enforcer except audio), but it goes against Chrome's stated intent [C5, C16], and the justification string is reviewer- and possibly user-visible. A future Chromium lifetime enforcer could close it without notice. No CWS policy text naming this pattern was found.
5. **Firefox keep-alive policy.** The source shows API calls reset the 30 s timer, but no AMO policy statement on deliberate keep-alive was found.
6. **Safari offscreen and shipping status.** WebKit `main` has the offscreen API compiled on in "testable mode" (Aug 2026). Which Safari release ships it, if any, is unknown. It is also not documented that Safari.app's unload heuristics equal the open-source `WKWebExtension` code (30 s / 2 min ports); Apple says unloading also depends on memory pressure [S1].
7. **Safari messaging serialisation** (JSON vs structured clone) is not documented by Apple; needs a test.
8. **Extension auto-update wipes `storage.session`** in Chrome and Firefox [C7, F7], so updates lock the vault. This is a UX consequence #12 should weigh.
9. **Cross-origin isolation for parallel Argon2** (offscreen document + `WORKERS` + `SharedArrayBuffer`) is untested for extensions.
10. **Firefox MV2 longevity** rests on a March 2024 blog statement. No newer Mozilla commitment was found.

## Sources

Chrome / Chromium

- [C1] The extension service worker lifecycle. https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle [last updated 2023-05-02]
- [C2] Migrate to a service worker. https://developer.chrome.com/docs/extensions/develop/migrate/to-service-workers [2023-03-09]
- [C3] Extension service worker basics. https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/basics [2023-05-02]
- [C4] `chrome.offscreen` API reference. https://developer.chrome.com/docs/extensions/reference/api/offscreen [2026-09-21]
- [C5] Offscreen Documents in Manifest V3 (blog). https://developer.chrome.com/blog/Offscreen-Documents-in-Manifest-v3 [2023-01-25]
- [C6] Chromium `extensions/browser/api/offscreen/lifetime_enforcer_factories.cc`. https://chromium.googlesource.com/chromium/src/+/main/extensions/browser/api/offscreen/lifetime_enforcer_factories.cc [main, 2026-10-06]
- [C7] `chrome.storage` API reference. https://developer.chrome.com/docs/extensions/reference/api/storage [2026-09-11]
- [C8] Chromium `extensions/browser/api/storage/session_storage_manager.h`. https://chromium.googlesource.com/chromium/src/+/main/extensions/browser/api/storage/session_storage_manager.h [main, 2026-10-06]
- [C9] Message passing. https://developer.chrome.com/docs/extensions/develop/concepts/messaging [2025-12-03]
- [C10] Manifest: Content Security Policy. https://developer.chrome.com/docs/extensions/reference/manifest/content-security-policy [2024-02-13]
- [C11] Content scripts. https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts
- [C12] `chrome.sidePanel` API reference. https://developer.chrome.com/docs/extensions/reference/api/sidePanel [2026-09-11]
- [C13] Add a popup. https://developer.chrome.com/docs/extensions/develop/ui/add-popup [2023-12-12]
- [C14] Cross-origin isolation. https://developer.chrome.com/docs/extensions/develop/concepts/cross-origin-isolation [2021-08-03]
- [C15] Manifest V2 support timeline. https://developer.chrome.com/docs/extensions/develop/migrate/mv2-deprecation-timeline
- [C16] chromium-extensions group, "Offscreen document reason: web workers?", Simeon Vincent (Chrome DevRel), 2022-12-15. https://groups.google.com/a/chromium.org/g/chromium-extensions/c/tIgizA-58pE

Firefox / Mozilla (source at `mozilla-firefox/firefox@4b5e436b8bc9`)

- [F1] MDN `background` manifest key. https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/background [2026-09-05]
- [F2] MDN Background scripts. https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Background_scripts [2026-07-27]
- [F3] `toolkit/components/extensions/parent/ext-backgroundPage.js` (idle timeout pref ~L26-34; native-port / listener / StreamFilter exemptions ~L885-950; `IdleManager` ~L1030-1140). https://github.com/mozilla-firefox/firefox/blob/4b5e436b8bc9/toolkit/components/extensions/parent/ext-backgroundPage.js
- [F4] `toolkit/components/extensions/ExtensionParent.sys.mjs` (`parentapicall` reset, ~L1290). https://github.com/mozilla-firefox/firefox/blob/4b5e436b8bc9/toolkit/components/extensions/ExtensionParent.sys.mjs
- [F5] `toolkit/components/extensions/ExtensionCommon.sys.mjs` (`event` reset, ~L2776). https://github.com/mozilla-firefox/firefox/blob/4b5e436b8bc9/toolkit/components/extensions/ExtensionCommon.sys.mjs
- [F6] MDN `storage.session`. https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/storage/session [2026-10-04]
- [F7] `toolkit/components/extensions/schemas/storage.json` (session description), `parent/ext-storage.js` ("not exposed to content scripts"), `ExtensionStorage.sys.mjs` (`QuotaMap.QUOTA_BYTES = 10485760`, `StructuredCloneHolder`), `modules/libpref/init/all.js` (`webextensions.storage.session.enforceQuota` = true). https://github.com/mozilla-firefox/firefox/tree/4b5e436b8bc9/toolkit/components/extensions
- [F8] MDN Chrome incompatibilities (message serialisation). https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Chrome_incompatibilities
- [F9] MDN `content_security_policy` manifest key. https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/content_security_policy
- [F10] MDN browser-compat-data: `webextensions/api/storage.json`, `api/runtime.json`, `api/sidePanel.json`, `manifest/background.json`, `manifest/sidebar_action.json`, `manifest/content_security_policy.json`, `http/headers/Content-Security-Policy.json`. https://github.com/mdn/browser-compat-data (main, 2026-10-06)
- [F11] Bugzilla 1573659 ([meta] Background Service Worker for MV3, NEW), 1443253 (moz-extension iframes get content-script privileges, REOPENED), 1860304 (FIXED in 121), 1770909. https://bugzilla.mozilla.org/
- [F12] `modules/libpref/init/all.js`: `pref("extensions.backgroundServiceWorker.enabled", false, locked);` https://github.com/mozilla-firefox/firefox/blob/4b5e436b8bc9/modules/libpref/init/all.js
- [F13] Mozilla Add-ons Blog, "Manifest V3 & Manifest V2 (March 2024 update)". https://blog.mozilla.org/addons/2024/03/13/manifest-v3-manifest-v2-march-2024-update/

Safari / WebKit (source at `WebKit/WebKit@72305bceb435`)

- [S1] Apple, Optimizing your web extension for Safari. https://developer.apple.com/documentation/safariservices/optimizing-your-web-extension-for-safari
- [S2] WWDC23 session 10119, What's new in Safari extensions (Safari 16.4 `storage.session`). https://developer.apple.com/videos/play/wwdc2023/10119/
- [S3] WWDC22 session 10099, What's new in Safari Web Extensions (MV3, service workers, non-persistent pages). https://developer.apple.com/videos/play/wwdc2022/10099/
- [S4] `Source/WebKit/UIProcess/Extensions/WebExtensionContext.cpp` (`scheduleBackgroundContentToUnload`, 30 s) and `Cocoa/WebExtensionContextCocoa.mm` (iOS persistent refusal; `unloadBackgroundContentIfPossible`, 2 min port grace). https://github.com/WebKit/WebKit/tree/72305bceb435/Source/WebKit/UIProcess/Extensions
- [S5] `Source/WebKit/UIProcess/Extensions/WebExtension.cpp` (MV3 must be non-persistent, ~L1206-1216). https://github.com/WebKit/WebKit/blob/72305bceb435/Source/WebKit/UIProcess/Extensions/WebExtension.cpp
- [S6] `Source/WebKit/Shared/Extensions/WebExtensionConstants.h` (`webExtensionStorageAreaSessionQuotaBytes = 10 * 1024 * 1024`) and `WebExtensionContext.cpp` (`sessionStorageStore()` uses `UsesInMemoryDatabase::Yes`). https://github.com/WebKit/WebKit/tree/72305bceb435/Source/WebKit
- [S7] WebKit commit 1d2141761faa, "Web Extensions: Add support for the offscreen API" (2026-08-08, bugs.webkit.org/321216), and `Source/WTF/wtf/PlatformEnableCocoa.h` (`ENABLE_WK_WEB_EXTENSIONS_OFFSCREEN`, `ENABLE_WK_WEB_EXTENSIONS_SIDEBAR 0`). https://github.com/WebKit/WebKit/commit/1d2141761faac89e4a85fc49cf2f9fc3fb15c145
- [S8] WWDC26 session 216, Create web extensions for Safari. https://developer.apple.com/videos/play/wwdc2026/216/

KDBX core

- [K1] keepass-rs @ `d08c68084cd4`: `src/db/open.rs` (public `open/parse` take `DatabaseKey`), `src/format/kdbx4/parse.rs` (~L80-90 KDF on open), `src/format/kdbx4/dump.rs` (~L35-77 fresh seeds plus KDF on save), `src/config.rs` (`get_kdf_and_seed`), `src/crypt/kdf.rs` (~L68-72 `ThreadMode::Sequential` on wasm32). https://github.com/sseemayer/keepass-rs/tree/d08c68084cd4/src
- [K2] KeePassXC @ `9e0f57a4a4c6`: `src/crypto/kdf/Argon2Kdf.h` (`ARGON2_DEFAULT_ROUNDS = 10`, `MEMORY = 1 << 16` KiB, `PARALLELISM = 4`), `src/crypto/kdf/Kdf.h` (`DEFAULT_ENCRYPTION_TIME = 1000` ms). https://github.com/keepassxreboot/keepassxc/tree/9e0f57a4a4c6/src/crypto/kdf

Prior art

- [B1] Bitwarden clients @ `a6ffbe65a3b6`: `apps/browser/src/background/main.background.ts` (~L667-698), `src/platform/services/local-backed-session-storage.service.ts`, `src/platform/services/browser-memory-storage.service.ts`, `src/platform/offscreen-document/`, `src/platform/services/sdk/browser-sdk-load.service.ts`, `src/manifest.v3.json`, `src/manifest.json`, `webpack.base.js` (L15), `.github/workflows/build-browser.yml` (L249-277). https://github.com/bitwarden/clients/tree/a6ffbe65a3b6/apps/browser
- [X1] KeePassXC-Browser @ `8b0b2c434712`: `dist/manifest_chromium.json`, `dist/manifest_firefox.json`, `keepassxc-browser/background/client.js` (L402 `connectNative`), `background/offscreen.js` (L17 `MATCH_MEDIA`). https://github.com/keepassxreboot/keepassxc-browser/tree/8b0b2c434712
- [P1] Proton WebClients @ `d09d7069e68b`: `applications/pass-extension/manifest-{chrome,firefox,safari}.json`, `src/app/worker/services/auth/auth.service.ts` (L120, L134, L267), `src/app/worker/offscreen/offscreen.utils.ts` (L11), `packages/pass/lib/extension/storage/session.ts` (L23-28), `packages/pass/lib/extension/storage/memory.ts`, `packages/pass/lib/auth/session.ts` (`SESSION_KEYS`). https://github.com/ProtonMail/WebClients/tree/d09d7069e68b
